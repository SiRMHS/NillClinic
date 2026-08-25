/**
 * Resumable full backfill of every CRM entity.
 *
 *   pnpm --filter @jordan/sync-engine backfill
 *   pnpm --filter @jordan/sync-engine backfill -- --entities=RECEPTIONS,TREATMENTS
 *   pnpm --filter @jordan/sync-engine backfill -- --from=1403/01/01 --window=3
 *
 * Progress is checkpointed in sync_job_states after every batch, so an
 * interrupted run resumes where it stopped rather than restarting. Entities
 * already marked `reachedEnd` are skipped; pass --reset to run them again.
 */
import { readFileSync } from "node:fs";
import { createCipheriv, randomBytes, scryptSync } from "node:crypto";
import { resolve } from "node:path";
import { prisma, type SyncEntity } from "@jordan/db";
import { JordanApiClient } from "../jordan-api.client.js";
import { ALL_SYNC_ENTITIES, CrmSyncService } from "../crm-sync.service.js";
import type { EncryptFn } from "../types.js";

/** Minimal .env loader so the script runs without adding a dependency. */
function loadEnv(path: string): void {
  let contents: string;
  try {
    contents = readFileSync(path, "utf8");
  } catch {
    return;
  }
  for (const line of contents.split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1]!;
    if (process.env[key]) continue;
    process.env[key] = match[2]!.trim().replace(/^["']|["']$/g, "");
  }
}

function createEncryptFn(): EncryptFn {
  const raw = process.env.ENCRYPTION_KEY;
  const key = raw ? Buffer.from(raw, "base64") : scryptSync("dev-only-key", "jordan-salt", 32);
  if (key.length !== 32) throw new Error("ENCRYPTION_KEY must be 32 bytes (base64)");

  return (plaintext: string): string => {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64");
  };
}

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.split("=").slice(1).join("=");
}
const flag = (name: string): boolean => process.argv.includes(`--${name}`);

async function main(): Promise<void> {
  loadEnv(resolve(process.cwd(), "../.env"));
  loadEnv(resolve(process.cwd(), ".env"));

  const baseUrl = process.env.JORDAN_API_BASE_URL;
  if (!baseUrl) throw new Error("JORDAN_API_BASE_URL is not set");

  const entities = (arg("entities")?.split(",").map((e) => e.trim().toUpperCase()) ??
    ALL_SYNC_ENTITIES) as SyncEntity[];
  const pageSize = Number(arg("pageSize") ?? 1000);
  const windowDays = arg("window") ? Number(arg("window")) : undefined;
  const concurrency = Number(arg("concurrency") ?? 4);
  const historyStart = arg("from");

  if (flag("reset")) {
    await prisma.syncJobState.updateMany({
      where: { entity: { in: entities } },
      data: {
        status: "IDLE",
        lastPage: 1,
        cursorDate: null,
        recordsRead: 0,
        recordsUpserted: 0,
        recordsFailed: 0,
        reachedEnd: false,
        startedAt: null,
        finishedAt: null,
        errorMessage: null,
      },
    });
    console.log(`checkpoints reset for ${entities.join(", ")}`);
  }

  const api = new JordanApiClient({
    baseUrl,
    username: process.env.JORDAN_API_USERNAME ?? "",
    password: process.env.JORDAN_API_PASSWORD ?? "",
    company: process.env.JORDAN_API_COMPANY ?? "Jordan",
  });
  const service = new CrmSyncService(api, createEncryptFn());

  const controller = new AbortController();
  const stop = () => {
    console.log("\ninterrupt received — finishing current batch, progress is checkpointed");
    controller.abort();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  console.log(`backfill starting: ${entities.join(", ")}`);
  console.log(`host=${baseUrl} pageSize=${pageSize} concurrency=${concurrency}`);

  const started = Date.now();
  let lastLog = 0;

  for (const entity of entities) {
    if (controller.signal.aborted) break;
    const t0 = Date.now();
    process.stdout.write(`\n[${entity}] `);

    await service.syncAllAuto({
      signal: controller.signal,
      entities: [entity],
      pageSize,
      windowDays,
      concurrency,
      historyStart,
      throttleDelayMs: Number(process.env.SYNC_THROTTLE_MS ?? 0),
    });

    const state = await prisma.syncJobState.findUnique({ where: { entity } });
    const secs = ((Date.now() - t0) / 1000).toFixed(0);
    console.log(
      `${state?.status} in ${secs}s — read=${state?.recordsRead} upserted=${state?.recordsUpserted} ` +
        `failed=${state?.recordsFailed} done=${state?.reachedEnd}` +
        (state?.errorMessage ? ` err=${state.errorMessage}` : ""),
    );
    void lastLog;
  }

  const counts = await prisma.$queryRawUnsafe<{ t: string; n: bigint }[]>(`
    SELECT 'patients' AS t, COUNT(*) AS n FROM patients
    UNION ALL SELECT 'services', COUNT(*) FROM services
    UNION ALL SELECT 'reserves', COUNT(*) FROM reserves
    UNION ALL SELECT 'treatments', COUNT(*) FROM treatments
    UNION ALL SELECT 'receptions', COUNT(*) FROM receptions
    UNION ALL SELECT 'reception_items', COUNT(*) FROM reception_items;`);

  console.log(`\ntotal ${((Date.now() - started) / 1000 / 60).toFixed(1)} min`);
  for (const c of counts) console.log(`  ${c.t.padEnd(16)} ${Number(c.n).toLocaleString()}`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("backfill failed:", err);
  await prisma.$disconnect();
  process.exit(1);
});
