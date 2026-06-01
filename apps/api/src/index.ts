import "dotenv/config";
import { app } from "./app.js";
import { registerCronJobs } from "@jordan/sync-engine";
import { createEncryptFn } from "./security/encryption.js";

const port = Number(process.env.API_PORT ?? 4000);

const encrypt = createEncryptFn();
registerCronJobs(encrypt);

app.listen(port, () => {
  console.info(`[api] Jordan Clinic API listening on :${port}`);
});
