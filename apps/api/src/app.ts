import express from "express";
import cors from "cors";
import helmet from "helmet";
import { financialRouter } from "./routes/financial.routes.js";
import { reportsRouter } from "./routes/reports.routes.js";
import { visitorsRouter } from "./routes/visitors.routes.js";
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
import { securityRouter } from "./routes/security.routes.js";
import { crmDeskRouter } from "./routes/crm-desk.routes.js";
import { requireAuth } from "./middleware/auth.middleware.js";
import { csrfProtection } from "./middleware/csrf.middleware.js";
import { apiRateLimit, webhookRateLimit } from "./middleware/rate-limit.middleware.js";
import { errorHandler } from "./middleware/error.middleware.js";

export const app = express();

// Behind a reverse proxy, req.ip / x-forwarded-for is only trustworthy when
// Express is told how many proxies sit in front — otherwise every rate limit and
// audit entry records the proxy's address instead of the client's.
app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS ?? 1));
app.disable("x-powered-by");

app.use(
  helmet({
    // The API serves JSON only, so it can afford a maximally restrictive policy:
    // nothing should ever be loaded or framed from one of its responses.
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
      },
    },
    hsts: { maxAge: 31_536_000, includeSubDomains: true, preload: true },
    referrerPolicy: { policy: "no-referrer" },
    crossOriginResourcePolicy: { policy: "same-site" },
    frameguard: { action: "deny" },
    noSniff: true,
  }),
);

/**
 * Credentialed CORS must name explicit origins — `*` is rejected by browsers
 * once cookies are involved, and echoing back any Origin would let any site
 * make authenticated calls.
 */
const allowedOrigins = (process.env.WEB_ORIGIN ?? "http://localhost:3000")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      // Same-origin/server-to-server requests send no Origin header.
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("Origin not allowed"));
    },
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization", "X-CSRF-Token"],
  }),
);

app.use(express.json({ limit: "1mb" }));

// Rejects state-changing cookie-authenticated requests that do not echo the
// CSRF token. Registered before the routers so every one of them is covered.
app.use(csrfProtection);

app.use("/health", healthRouter);
// NOT rate-limited as a whole: /api/auth/me runs on every page load, so a
// 10/min budget across the router would log active users out of their own
// session. The strict limit lives on /login inside the router itself.
app.use("/api/auth", authRouter);

app.use("/api", apiRateLimit);
app.use("/api/analytics", requireAuth, analyticsRouter);
app.use("/api/financial", requireAuth, financialRouter);
app.use("/api/reports", requireAuth, reportsRouter);
app.use("/api/visitors", requireAuth, visitorsRouter);
app.use("/api/leads/webhook", webhookRateLimit, leadsWebhookRouter);
app.use("/api/leads", requireAuth, leadsRouter);
app.use("/api/campaigns", requireAuth, campaignsRouter);
app.use("/api/patients", requireAuth, patientsRouter);
app.use("/api/sync", requireAuth, syncRouter);
app.use("/api/receptions", requireAuth, receptionsRouter);
app.use("/api/admin", requireAuth, adminRouter);
app.use("/api/webhook-logs", requireAuth, webhookLogsRouter);
app.use("/api/security", requireAuth, securityRouter);
app.use("/api/crm-desk", requireAuth, crmDeskRouter);

app.use(errorHandler);
