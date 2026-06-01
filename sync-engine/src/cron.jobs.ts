import cron from "node-cron";
import { CrmSyncService, type SyncConfig } from "./crm-sync.service.js";
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

export function registerCronJobs(encrypt: EncryptFn): void {
  const enabled = process.env.SYNC_CRON_ENABLED !== "false";
  const schedule = process.env.SYNC_CRON_SCHEDULE ?? "0 */6 * * *";

  if (!enabled) return;

  initSyncEngine(encrypt);

  const crontConfig: SyncConfig = {
    maxPages: Number(process.env.SYNC_MAX_PAGES) || 1,
    pageSize: Number(process.env.SYNC_PAGE_SIZE) || 50,
  };

  cron.schedule(schedule, () => {
    void syncService?.syncAll("CRON", crontConfig);
  });
}

export async function runManualSync(encrypt: EncryptFn, config?: SyncConfig) {
  const service = syncService ?? initSyncEngine(encrypt);
  return service.syncAll("MANUAL", config);
}
