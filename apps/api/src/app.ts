import express from "express";
import cors from "cors";
import helmet from "helmet";
import { analyticsRouter } from "./routes/analytics.routes.js";
import { healthRouter } from "./routes/health.routes.js";
import { leadsRouter, leadsWebhookRouter } from "./routes/leads.routes.js";
import { campaignsRouter } from "./routes/campaigns.routes.js";
import { patientsRouter } from "./routes/patients.routes.js";
import { receptionsRouter } from "./routes/receptions.routes.js";
import { syncRouter } from "./routes/sync.routes.js";
import { authRouter } from "./routes/auth.routes.js";
import { adminRouter } from "./routes/admin.routes.js";
import { webhookLogsRouter } from "./routes/webhook-logs.routes.js";
import { requireAuth } from "./middleware/auth.middleware.js";
import { webhookRateLimit } from "./middleware/rate-limit.middleware.js";
import { errorHandler } from "./middleware/error.middleware.js";

export const app = express();

app.use(helmet());
app.use(
  cors({
    origin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
    credentials: true,
  }),
);
app.use(express.json({ limit: "1mb" }));

app.use("/health", healthRouter);
app.use("/api/auth", authRouter);
app.use("/api/analytics", requireAuth, analyticsRouter);
app.use("/api/leads/webhook", webhookRateLimit, leadsWebhookRouter);
app.use("/api/leads", requireAuth, leadsRouter);
app.use("/api/campaigns", requireAuth, campaignsRouter);
app.use("/api/patients", requireAuth, patientsRouter);
app.use("/api/sync", requireAuth, syncRouter);
app.use("/api/receptions", requireAuth, receptionsRouter);
app.use("/api/admin", requireAuth, adminRouter);
app.use("/api/webhook-logs", requireAuth, webhookLogsRouter);

app.use(errorHandler);
