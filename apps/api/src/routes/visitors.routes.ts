import { Router } from "express";
import { z } from "zod";
import { financialRangeSchema, patientVipUpdateSchema } from "@jordan/shared";
import { VisitorAnalyticsService } from "../services/visitor-analytics.service.js";
import { TierService } from "../services/tier.service.js";
import { requireAnyPermission, requirePermission } from "../middleware/permission.middleware.js";
import { jalaliToday } from "@jordan/shared";
import { sendCsv, stampedFilename, toCsv, type CsvColumn } from "../lib/csv.js";
import { displayMask } from "../middleware/display.middleware.js";

export const visitorsRouter = Router();
const visitors = new VisitorAnalyticsService();
const tiers = new TierService();

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
    "patients.view",
    "patients.vip",
    "financial.patients",
    "financial.tiers",
    "reports.referrals",
  ),
);

const parseRange = (query: unknown) => financialRangeSchema.parse(query ?? {});

// JSON responses are masked centrally — see middleware/display.middleware.ts.
// These endpoints answer to the site-wide switch only, not the CRM-scoped one:
// they back the dashboard and the patient dialog as well as تحلیل مراجعین, so
// honouring the CRM switch here would blank figures on pages that switch says
// nothing about. The exports below ask `displayMask` so a hidden money column
// is dropped from the file rather than left as an empty one.

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

/**
 * Assign or clear a patient's manual VIP / celebrity standing.
 *
 * Sits on this router because the patient dialog it is operated from is here,
 * but behind its own key: the dialog opens for anyone who can read a report,
 * while deciding that a patient is VIP is a commercial call. Setting it
 * re-derives that patient's tier immediately — see TierService.setVipFlag.
 */
visitorsRouter.patch(
  "/patient/:externalCode/vip",
  requirePermission("patients.vip"),
  async (req, res, next) => {
    try {
      const code = z.coerce.number().int().parse(req.params.externalCode);
      const { vipFlag, note } = patientVipUpdateSchema.parse(req.body ?? {});
      const result = await tiers.setVipFlag(code, vipFlag, note ?? null, req.user?.sub ?? null);
      if (!result) {
        res.status(404).json({ error: "بیمار یافت نشد" });
        return;
      }
      res.json(result);
    } catch (e) {
      next(e);
    }
  },
);

// ─── Exports ───
//
// One endpoint with a `dataset` parameter rather than six sibling routes: the
// تحلیل مراجعین page is a set of tabs over the same date range, and the export
// button on each tab differs only in which table it is pointed at.
//
// Amounts follow the same rule as the JSON above — the site-wide switch drops
// the money columns, and the column is dropped rather than blanked so nobody
// goes looking for data behind an empty header.

const exportQuery = z.object({
  dataset: z.enum(["services", "conversion", "doctors", "retention", "follow-up"]),
});

visitorsRouter.get("/export", requirePermission("reports.export"), async (req, res, next) => {
  try {
    const { dataset } = exportQuery.parse(req.query);
    const range = parseRange(req.query);
    const noAmounts = displayMask(req).amounts;

    /** Keeps a money column out of the file entirely when amounts are hidden. */
    const money = <T,>(column: CsvColumn<T>): CsvColumn<T>[] => (noAmounts ? [] : [column]);

    if (dataset === "services") {
      const { limit, kind } = popularityQuery.parse(req.query);
      // The panel shows a top and a bottom slice; the file is the whole list,
      // top first, because a report that stops at ten rows is not a report.
      const { top, bottom } = await visitors.getServicePopularity(range, {
        limit: Math.max(limit, 50),
        kind,
      });
      const seen = new Set(top.map((r) => r.serviceName));
      const rows = [...top, ...bottom.filter((r) => !seen.has(r.serviceName))];
      const csv = toCsv(rows, [
        { header: "نام خدمت", value: (r) => r.serviceName },
        { header: "بخش", value: (r) => r.sectionName ?? "" },
        { header: "نوع", value: (r) => (r.kind === "consultation" ? "مشاوره" : "درمان") },
        { header: "تعداد پذیرش", value: (r) => r.receptionCount },
        { header: "تعداد بیمار", value: (r) => r.patientCount },
        ...money<(typeof rows)[number]>({ header: "درآمد (ریال)", value: (r) => r.revenue }),
        ...money<(typeof rows)[number]>({ header: "میانگین مبلغ (ریال)", value: (r) => r.averagePrice }),
        { header: "سهم (٪)", value: (r) => Math.round(r.share * 1000) / 10 },
      ]);
      sendCsv(res, stampedFilename("خدمات-مراجعین", jalaliToday()), csv);
      return;
    }

    if (dataset === "conversion") {
      const rows = await visitors.getConversionByType(range);
      const csv = toCsv(rows, [
        { header: "نوع مشاوره", value: (r) => r.consultationName },
        { header: "بیمار مشاوره‌شده", value: (r) => r.consultedPatients },
        { header: "بیمار تبدیل‌شده", value: (r) => r.convertedPatients },
        { header: "نرخ تبدیل (٪)", value: (r) => Math.round(r.conversionRate * 1000) / 10 },
        ...money<(typeof rows)[number]>({ header: "درآمد پس از آن (ریال)", value: (r) => r.revenueAfter }),
      ]);
      sendCsv(res, stampedFilename("نرخ-تبدیل-مشاوره", jalaliToday()), csv);
      return;
    }

    if (dataset === "doctors") {
      const rows = await visitors.getDoctorRanking(range, 200);
      const csv = toCsv(rows, [
        { header: "نام پزشک", value: (r) => r.personnelName },
        ...money<(typeof rows)[number]>({ header: "درآمد (ریال)", value: (r) => r.revenue }),
        { header: "تعداد بیمار", value: (r) => r.patientCount },
        { header: "تعداد پذیرش", value: (r) => r.receptionCount },
        { header: "خط درمان", value: (r) => r.procedureLines },
        { header: "خط مشاوره", value: (r) => r.consultationLines },
        ...money<(typeof rows)[number]>({ header: "میانگین هر پذیرش (ریال)", value: (r) => r.averageTicket }),
        { header: "نرخ بازگشت بیمار (٪)", value: (r) => Math.round(r.repeatPatientRate * 1000) / 10 },
        {
          header: "نرخ تبدیل (٪)",
          value: (r) => (r.conversionRate === null ? "" : Math.round(r.conversionRate * 1000) / 10),
        },
        ...money<(typeof rows)[number]>({
          header: "سهم از درآمد (٪)",
          value: (r) => Math.round(r.revenueShare * 1000) / 10,
        }),
      ]);
      sendCsv(res, stampedFilename("رتبه‌بندی-پزشکان-مراجعین", jalaliToday()), csv);
      return;
    }

    if (dataset === "retention") {
      const rows = await visitors.getVisitFrequency(range);
      const csv = toCsv(rows, [
        { header: "تعداد مراجعه", value: (r) => r.visits },
        { header: "تعداد بیمار", value: (r) => r.patientCount },
        ...money<(typeof rows)[number]>({ header: "درآمد (ریال)", value: (r) => r.revenue }),
      ]);
      sendCsv(res, stampedFilename("تناوب-مراجعه", jalaliToday()), csv);
      return;
    }

    const { minDays, maxDays, limit } = followUpQuery.parse(req.query);
    const { candidates } = await visitors.getFollowUpCandidates({ minDays, maxDays, limit: 500 });
    void limit;
    const csv = toCsv(candidates, [
      { header: "شماره پرونده", value: (r) => r.patientExternalCode },
      { header: "نام بیمار", value: (r) => r.fullName ?? "" },
      { header: "موبایل", value: (r) => r.mobile ?? "" },
      { header: "آخرین مراجعه", value: (r) => r.lastVisitDate ?? "" },
      { header: "روز از آخرین مراجعه", value: (r) => r.daysSinceLastVisit },
      { header: "تعداد مراجعه", value: (r) => r.visitCount },
      ...money<(typeof candidates)[number]>({ header: "مجموع دریافتی (ریال)", value: (r) => r.totalReceived }),
      { header: "آخرین خدمات", value: (r) => r.lastServices ?? "" },
    ]);
    sendCsv(res, stampedFilename("کاندیدهای-پیگیری", jalaliToday()), csv);
  } catch (e) {
    next(e);
  }
});
