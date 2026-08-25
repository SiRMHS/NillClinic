import cron from "node-cron";
import { CrmSyncService, type SyncConfig, type IncrementalOptions } from "./crm-sync.service.js";
import type { SyncEntity } from "@jordan/db";
import { JordanApiClient } from "./jordan-api.client.js";
import type { EncryptFn } from "./types.js";

let syncService: CrmSyncService | null = null;

export function initSyncEngine(encrypt: EncryptFn): CrmSyncService {
  const api = new JordanApiClient({
    baseUrl: process.env.JORDAN_API_BASE_URL ?? "",
    username: process.env.JORDAN_API_USERNAME ?? "",
    password: process.env.JORDAN_API_PASSWORD ?? "",
    company: process.env.JORDAN_API_COMPANY ?? "Jordan",
  });
  syncService = new CrmSyncService(api, encrypt);
  return syncService;
}

/**
 * Env-driven cron entry point, kept for deployments that prefer a fixed
 * schedule in configuration. The dashboard's own scheduler (see
 * apps/api/src/services/sync-scheduler.service.ts) is the supported path —
 * it stores its interval in the database so operators can change it without a
 * redeploy — and this is only wired up when SYNC_CRON_ENABLED is set to "true".
 */
export function registerCronJobs(encrypt: EncryptFn): void {
  if (process.env.SYNC_CRON_ENABLED !== "true") return;

  const schedule = process.env.SYNC_CRON_SCHEDULE ?? "0 * * * *";
  initSyncEngine(encrypt);

  cron.schedule(schedule, () => {
    void syncService?.syncAllIncremental({
      lookbackDays: Number(process.env.SYNC_LOOKBACK_DAYS) || undefined,
      pageSize: Number(process.env.SYNC_PAGE_SIZE) || undefined,
    });
  });
}

export async function runManualSync(encrypt: EncryptFn, config?: SyncConfig) {
  const service = syncService ?? initSyncEngine(encrypt);
  return service.syncAll("MANUAL", config);
}

export async function runAutoSync(
  encrypt: EncryptFn,
  opts: { signal?: AbortSignal; entities?: SyncEntity[]; throttleDelayMs?: number; pageSize?: number },
) {
  const service = syncService ?? initSyncEngine(encrypt);
  return service.syncAllAuto(opts);
}

/** One pass of the scheduled refresh over the recent slice only. */
export async function runIncrementalSync(encrypt: EncryptFn, opts: IncrementalOptions = {}) {
  const service = syncService ?? initSyncEngine(encrypt);
  return service.syncAllIncremental(opts);
}
