import "dotenv/config";
import { app } from "./app.js";
import { resumeAutoSyncOnStartup } from "./routes/sync.routes.js";

const port = Number(process.env.API_PORT ?? 4000);

app.listen(port, () => {
  console.info(`[api] Jordan Clinic API listening on :${port}`);
  void resumeAutoSyncOnStartup();
});
