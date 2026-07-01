import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const envPath = resolve(import.meta.dirname, "../.env");
for (const line of readFileSync(envPath, "utf8").split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq === -1) continue;
  const key = trimmed.slice(0, eq);
  const val = trimmed.slice(eq + 1).replace(/^["']|["']$/g, "");
  if (!process.env[key]) process.env[key] = val;
}

async function main() {
  const { purgeCrmData, runManualSync } = await import("../sync-engine/dist/index.js");
  const { createEncryptFn } = await import("../apps/api/dist/security/encryption.js");

  console.log("Purging CRM data...");
  const counts = await purgeCrmData();
  console.log("Purged:", counts);

  console.log("Starting full re-sync with normalization...");
  const results = await runManualSync(createEncryptFn(), {
    maxPages: 50,
    pageSize: 100,
    entities: ["PATIENTS", "SERVICES", "RESERVES", "TREATMENTS", "RECEPTIONS"],
  });

  for (const r of results) {
    console.log(
      `${r.entity}: ${r.status} — read ${r.recordsRead}, upserted ${r.recordsUpserted}, failed ${r.recordsFailed}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
