import "dotenv/config";
import { app } from "./app.js";
import { resumeAutoSyncOnStartup } from "./routes/sync.routes.js";
import { startSyncScheduler } from "./services/sync-scheduler.service.js";

const port = Number(process.env.API_PORT ?? 4000);

app.listen(port, () => {
  console.info(`[api] Jordan Clinic API listening on :${port}`);
  void resumeAutoSyncOnStartup();
  // Picks the schedule back up from `sync_settings.next_run_at`, so a restart
  // does not reset the hourly cadence.
  startSyncScheduler();
});
