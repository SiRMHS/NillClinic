import { Router } from "express";
import { z } from "zod";
import { financialRangeSchema } from "@jordan/shared";
import { VisitorAnalyticsService } from "../services/visitor-analytics.service.js";
import { requireAnyPermission } from "../middleware/permission.middleware.js";

export const visitorsRouter = Router();
const visitors = new VisitorAnalyticsService();

/**
 * These endpoints have no page of their own — they back panels on several
 * sections, and `/patient/:externalCode` powers the patient dialog opened from
 * the ranking, tier and referral reports. So instead of a key of their own they
 * answer to whichever consuming section the caller may already open; a key
 * nothing in the sidebar corresponded to would just be a knob that breaks
 * pages when turned off.
 */
visitorsRouter.use(
  requireAnyPermission(
    "dashboard",
    "analytics",
    "crm",
    "financial.patients",
    "financial.tiers",
    "reports.referrals",
  ),
);

const parseRange = (query: unknown) => financialRangeSchema.parse(query ?? {});

const popularityQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
  kind: z.enum(["procedure", "consultation", "all"]).default("procedure"),
});

const followUpQuery = z.object({
  minDays: z.coerce.number().int().min(1).max(5000).default(180),
  maxDays: z.coerce.number().int().min(1).max(20000).default(1095),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

/** What slice of history these numbers cover — see the service for why. */
visitorsRouter.get("/coverage", async (_req, res, next) => {
  try {
    res.json(await visitors.getCoverage());
  } catch (e) {
    next(e);
  }
});

visitorsRouter.get("/services", async (req, res, next) => {
  try {
    const { limit, kind } = popularityQuery.parse(req.query);
    res.json(await visitors.getServicePopularity(parseRange(req.query), { limit, kind }));
  } catch (e) {
    next(e);
  }
});

visitorsRouter.get("/conversion", async (req, res, next) => {
  try {
    const range = parseRange(req.query);
    const [summary, byType] = await Promise.all([
      visitors.getConversionSummary(range),
      visitors.getConversionByType(range),
    ]);
    res.json({ summary, byType });
  } catch (e) {
    next(e);
  }
});

visitorsRouter.get("/doctors", async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 50) || 50, 200);
    res.json(await visitors.getDoctorRanking(parseRange(req.query), limit));
  } catch (e) {
    next(e);
  }
});

visitorsRouter.get("/retention", async (req, res, next) => {
  try {
    const range = parseRange(req.query);
    const [summary, frequency] = await Promise.all([
      visitors.getRetentionSummary(range),
      visitors.getVisitFrequency(range),
    ]);
    res.json({ summary, frequency });
  } catch (e) {
    next(e);
  }
});

visitorsRouter.get("/follow-up", async (req, res, next) => {
  try {
    res.json(await visitors.getFollowUpCandidates(followUpQuery.parse(req.query)));
  } catch (e) {
    next(e);
  }
});

visitorsRouter.get("/patient/:externalCode", async (req, res, next) => {
  try {
    const code = z.coerce.number().int().parse(req.params.externalCode);
    const detail = await visitors.getPatientDetail(code);
    if (!detail) {
      res.status(404).json({ error: "بیمار یافت نشد" });
      return;
    }
    res.json(detail);
  } catch (e) {
    next(e);
  }
});
