import { Router } from "express";
import {
  financialGranularitySchema,
  financialRangeSchema,
  patientRankingQuerySchema,
} from "@jordan/shared";
import { FinancialService } from "../services/financial.service.js";
import { PatientRankingService } from "../services/patient-ranking.service.js";
import { requirePermission, requireAnyPermission } from "../middleware/permission.middleware.js";

export const financialRouter = Router();
const financial = new FinancialService();
const ranking = new PatientRankingService();

// Revenue and per-patient spend are more sensitive than the existing
// aggregate analytics, so every route here is gated rather than relying on
// authentication alone.
// Money is gated on its own keys, not on general reporting: a role may be
// trusted with patient volumes and still have no business seeing revenue.
financialRouter.use(requireAnyPermission("financial", "financial.patients"));

/** Jalali `from`/`to` query params, both optional. */
function parseRange(query: unknown) {
  return financialRangeSchema.parse(query ?? {});
}

financialRouter.get("/summary", requirePermission("financial"), async (req, res, next) => {
  try {
    res.json(await financial.getSummary(parseRange(req.query)));
  } catch (e) {
    next(e);
  }
});

financialRouter.get("/trend", requirePermission("financial"), async (req, res, next) => {
  try {
    const granularity = financialGranularitySchema.parse(req.query.granularity ?? "month");
    res.json(await financial.getTrend(parseRange(req.query), granularity));
  } catch (e) {
    next(e);
  }
});

financialRouter.get("/by-service", requirePermission("financial"), async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 25) || 25, 200);
    res.json(await financial.getByService(parseRange(req.query), limit));
  } catch (e) {
    next(e);
  }
});

financialRouter.get("/by-section", requirePermission("financial"), async (req, res, next) => {
  try {
    res.json(await financial.getBySection(parseRange(req.query)));
  } catch (e) {
    next(e);
  }
});

financialRouter.get("/by-personnel", requirePermission("financial"), async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 50) || 50, 200);
    res.json(await financial.getByPersonnel(parseRange(req.query), limit));
  } catch (e) {
    next(e);
  }
});

// ─── Patient ranking (RFM) ───

financialRouter.get("/patients/ranking", requirePermission("financial.patients"), async (req, res, next) => {
  try {
    res.json(await ranking.list(patientRankingQuerySchema.parse(req.query)));
  } catch (e) {
    next(e);
  }
});

financialRouter.get("/patients/segments", requirePermission("financial.patients"), async (_req, res, next) => {
  try {
    res.json(await financial.getSegmentSummary());
  } catch (e) {
    next(e);
  }
});

/**
 * Rebuild RFM metrics. Scores are population quintiles, so they only shift when
 * the underlying reception data changes — recompute after a sync, not per request.
 */
financialRouter.post("/patients/ranking/recompute", requirePermission("financial.recompute"), async (_req, res, next) => {
  try {
    res.json(await ranking.recompute());
  } catch (e) {
    next(e);
  }
});
