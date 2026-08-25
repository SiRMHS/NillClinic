import { Router } from "express";
import {
  doctorReportQuerySchema,
  patientRankingQuerySchema,
  financialGranularitySchema,
  financialRangeSchema,
  jalaliToday,
  referralQuerySchema,
  tierActivityQuerySchema,
  tierSettingsUpdateSchema,
  PATIENT_TIER_LABELS,
  type PatientTier,
} from "@jordan/shared";
import { DoctorReportService } from "../services/doctor-report.service.js";
import { ReferralService } from "../services/referral.service.js";
import { TierService } from "../services/tier.service.js";
import { PatientRankingService } from "../services/patient-ranking.service.js";
import { requirePermission } from "../middleware/permission.middleware.js";
import { sendCsv, stampedFilename, toCsv } from "../lib/csv.js";

export const reportsRouter = Router();

const doctors = new DoctorReportService();
const referrals = new ReferralService();
const tiers = new TierService();
const ranking = new PatientRankingService();

// No blanket gate: this router mixes patient-volume reports with money
// (tier levels are lifetime spend, and the ranking export carries amounts),
// so each endpoint names the key that matches what it actually returns.

// ─── Tiers ───

reportsRouter.get("/tiers/summary", requirePermission("financial.tiers"), async (_req, res, next) => {
  try {
    res.json(await tiers.getSummary());
  } catch (e) {
    next(e);
  }
});

reportsRouter.get("/tiers/settings", requirePermission("financial.tiers"), async (_req, res, next) => {
  try {
    res.json(await tiers.getSettings());
  } catch (e) {
    next(e);
  }
});

/**
 * Update the thresholds and re-tier every patient in the same request.
 *
 * Saving without recomputing would leave the settings page and the ranking
 * table disagreeing about who is platinum until the next sync — the kind of
 * inconsistency that gets read as a bug in the numbers.
 */
reportsRouter.put("/tiers/settings", requirePermission("financial.tiers"), async (req, res, next) => {
  try {
    const update = tierSettingsUpdateSchema.parse(req.body ?? {});
    const settings = await tiers.updateSettings(update);
    const recompute = await ranking.recompute();
    res.json({ settings, recompute });
  } catch (e) {
    next(e);
  }
});

reportsRouter.get("/tiers/activity", requirePermission("financial.tiers"), async (req, res, next) => {
  try {
    res.json(await tiers.getActivity(tierActivityQuerySchema.parse(req.query)));
  } catch (e) {
    next(e);
  }
});

reportsRouter.get("/tiers/activity/stats", requirePermission("financial.tiers"), async (req, res, next) => {
  try {
    const raw = req.query.tiers;
    const list = raw === undefined || raw === ""
      ? undefined
      : (Array.isArray(raw) ? raw.map(String) : String(raw).split(",")) as PatientTier[];
    res.json(await tiers.getActivityStats(list));
  } catch (e) {
    next(e);
  }
});

reportsRouter.get("/tiers/activity/export", requirePermission("financial.export"), async (req, res, next) => {
  try {
    // The export is the whole filtered set, not the page on screen: a report
    // that silently stops at the current window is worse than no export.
    const query = tierActivityQuerySchema.parse({ ...req.query, limit: 500, offset: 0 });
    const { items } = await tiers.getActivity(query);

    const csv = toCsv(items, [
      { header: "نوع", value: (r) => (r.kind === "RESERVE" ? "نوبت" : "پذیرش") },
      { header: "تاریخ", value: (r) => r.date ?? "" },
      { header: "ساعت", value: (r) => r.time ?? "" },
      { header: "کد بیمار", value: (r) => r.patientExternalCode ?? "" },
      { header: "نام بیمار", value: (r) => r.fullName ?? "" },
      { header: "موبایل", value: (r) => r.mobile ?? "" },
      { header: "رتبه", value: (r) => r.tierLabel },
      { header: "مجموع خرید (ریال)", value: (r) => r.lifetimeSpend },
      { header: "تعداد مراجعه", value: (r) => r.visitCount },
      { header: "پزشک", value: (r) => r.doctorName ?? "" },
      { header: "خدمات", value: (r) => r.services ?? "" },
      { header: "مبلغ (ریال)", value: (r) => r.amount ?? "" },
      { header: "وضعیت", value: (r) => (r.isUpcoming ? "پیش‌رو" : r.isAccepted ? "انجام شده" : "") },
    ]);

    sendCsv(res, stampedFilename("گزارش-فعالیت-بیماران", jalaliToday()), csv);
  } catch (e) {
    next(e);
  }
});

// ─── Doctor report ───

reportsRouter.get("/doctors", requirePermission("reports.doctors"), async (req, res, next) => {
  try {
    res.json(await doctors.listDoctors(financialRangeSchema.parse(req.query ?? {})));
  } catch (e) {
    next(e);
  }
});

reportsRouter.get("/doctors/report", requirePermission("reports.doctors"), async (req, res, next) => {
  try {
    res.json(await doctors.getReport(doctorReportQuerySchema.parse(req.query)));
  } catch (e) {
    next(e);
  }
});

reportsRouter.get("/doctors/trend", requirePermission("reports.doctors"), async (req, res, next) => {
  try {
    const name = String(req.query.doctor ?? "").trim();
    if (!name) {
      res.status(400).json({ error: "نام پزشک الزامی است" });
      return;
    }
    const granularity = financialGranularitySchema.parse(req.query.granularity ?? "month");
    res.json(await doctors.getTrend(name, financialRangeSchema.parse(req.query), granularity));
  } catch (e) {
    next(e);
  }
});

reportsRouter.get("/doctors/report/export", requirePermission("reports.export"), async (req, res, next) => {
  try {
    const query = doctorReportQuerySchema.parse({ ...req.query, limit: 500 });
    const report = await doctors.getReport(query);

    const csv = toCsv(report.rows, [
      { header: "پزشک", value: (r) => r.doctorName },
      { header: "تعداد پذیرش", value: (r) => r.receptionCount },
      { header: "تعداد خدمت", value: (r) => r.lineCount },
      { header: "تعداد بیمار", value: (r) => r.patientCount },
      { header: "بیمار جدید", value: (r) => r.newPatientCount },
      { header: "مشاوره", value: (r) => r.consultationCount },
      { header: "درمان", value: (r) => r.treatmentCount },
      { header: "درآمد (ریال)", value: (r) => r.received },
      { header: "تخفیف (ریال)", value: (r) => r.discount },
      { header: "مانده (ریال)", value: (r) => r.outstanding },
      { header: "میانگین هر بیمار (ریال)", value: (r) => Math.round(r.averagePerPatient) },
      { header: "میانگین هر پذیرش (ریال)", value: (r) => Math.round(r.averagePerReception) },
      { header: "سهم از درآمد", value: (r) => `${(r.revenueShare * 100).toFixed(2)}%` },
    ]);

    const suffix = query.from || query.to ? `${query.from ?? "ابتدا"}-تا-${query.to ?? "انتها"}` : jalaliToday();
    sendCsv(res, stampedFilename("گزارش-پزشکان", suffix), csv);
  } catch (e) {
    next(e);
  }
});

// ─── Referral report ───

reportsRouter.get("/referrals", requirePermission("reports.referrals"), async (req, res, next) => {
  try {
    res.json(await referrals.getReport(referralQuerySchema.parse(req.query)));
  } catch (e) {
    next(e);
  }
});

reportsRouter.get("/referrals/export", requirePermission("reports.export"), async (req, res, next) => {
  try {
    const query = referralQuerySchema.parse({ ...req.query, limit: 500, offset: 0 });
    const report = await referrals.getReport(query);

    const csv = toCsv(report.patients, [
      { header: "کد بیمار", value: (r) => r.patientExternalCode },
      { header: "نام بیمار", value: (r) => r.fullName ?? "" },
      { header: "موبایل", value: (r) => r.mobile ?? "" },
      { header: "رتبه", value: (r) => r.tierLabel ?? "" },
      { header: "تاریخ مشاوره", value: (r) => r.consultationDate ?? "" },
      { header: "تعداد مشاوره", value: (r) => r.consultationCount },
      { header: "پزشک درمان", value: (r) => r.treatingDoctors.join(" | ") },
      { header: "تعداد درمان", value: (r) => r.treatmentCount },
      { header: "اولین درمان", value: (r) => r.firstTreatmentDate ?? "" },
      { header: "آخرین درمان", value: (r) => r.lastTreatmentDate ?? "" },
      { header: "درآمد درمان (ریال)", value: (r) => r.treatmentReceived },
      { header: "درآمد پزشک مشاور (ریال)", value: (r) => r.consultingDoctorReceived },
      { header: "مجموع خرید بیمار (ریال)", value: (r) => r.lifetimeSpend },
    ]);

    sendCsv(res, stampedFilename("گزارش-ارجاع-مشاوره", jalaliToday()), csv);
  } catch (e) {
    next(e);
  }
});

// ─── Ranked patients export ───

reportsRouter.get("/patients/ranking/export", requirePermission("financial.export"), async (req, res, next) => {
  try {
    const query = patientRankingQuerySchema.parse({ ...req.query, limit: 500, offset: 0 });
    const { patients } = await ranking.list(query);

    const csv = toCsv(patients, [
      { header: "کد بیمار", value: (r) => r.patientExternalCode },
      { header: "نام بیمار", value: (r) => r.fullName ?? "" },
      { header: "موبایل", value: (r) => r.mobile ?? "" },
      { header: "رتبه", value: (r) => PATIENT_TIER_LABELS[r.tier] ?? r.tier },
      { header: "گروه رفتاری", value: (r) => r.segmentLabel },
      { header: "تعداد مراجعه", value: (r) => r.visitCount },
      { header: "مجموع پرداختی (ریال)", value: (r) => r.totalReceived },
      { header: "تخفیف (ریال)", value: (r) => r.totalDiscount },
      { header: "مانده (ریال)", value: (r) => r.totalOutstanding },
      { header: "میانگین هر مراجعه (ریال)", value: (r) => Math.round(r.averageTicket) },
      { header: "اولین مراجعه", value: (r) => r.firstVisitDate ?? "" },
      { header: "آخرین مراجعه", value: (r) => r.lastVisitDate ?? "" },
      { header: "روز از آخرین مراجعه", value: (r) => r.recencyDays ?? "" },
      { header: "امتیاز RFM", value: (r) => r.rfmScore },
    ]);

    sendCsv(res, stampedFilename("رتبه‌بندی-بیماران", jalaliToday()), csv);
  } catch (e) {
    next(e);
  }
});
