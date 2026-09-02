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
import { displayMask } from "../middleware/display.middleware.js";
import {
  FMT,
  addSheet,
  addSummarySheet,
  createWorkbook,
  sendXlsx,
  stampedXlsxName,
} from "../lib/xlsx.js";

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
      { header: "مجموع خرید (ریال)", value: (r) => r.lifetimeSpend, money: true },
      { header: "تعداد مراجعه", value: (r) => r.visitCount },
      { header: "پزشک", value: (r) => r.doctorName ?? "" },
      { header: "خدمات", value: (r) => r.services ?? "" },
      { header: "مبلغ (ریال)", value: (r) => r.amount ?? "", money: true },
      { header: "وضعیت", value: (r) => (r.isUpcoming ? "پیش‌رو" : r.isAccepted ? "انجام شده" : "") },
    ], { hideMoney: displayMask(req).amounts });

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
      { header: "مشاوره و ویزیت", value: (r) => r.consultationCount + r.visitCount },
      { header: "مشاوره", value: (r) => r.consultationCount },
      { header: "ویزیت", value: (r) => r.visitCount },
      { header: "خدمت", value: (r) => r.serviceCount },
      { header: "درآمد (ریال)", value: (r) => r.received, money: true },
      { header: "تخفیف (ریال)", value: (r) => r.discount, money: true },
      { header: "مانده (ریال)", value: (r) => r.outstanding, money: true },
      { header: "میانگین هر بیمار (ریال)", value: (r) => Math.round(r.averagePerPatient), money: true },
      { header: "میانگین هر پذیرش (ریال)", value: (r) => Math.round(r.averagePerReception), money: true },
      { header: "سهم از درآمد", value: (r) => `${(r.revenueShare * 100).toFixed(2)}%`, money: true },
    ], { hideMoney: displayMask(req).amounts });

    const suffix = query.from || query.to ? `${query.from ?? "ابتدا"}-تا-${query.to ?? "انتها"}` : jalaliToday();
    sendCsv(res, stampedFilename("گزارش-پزشکان", suffix), csv);
  } catch (e) {
    next(e);
  }
});

/**
 * The doctor report as a formatted workbook.
 *
 * The CSV next to it stays what it is — a flat dump for someone who will pivot
 * it themselves. This is the other thing the report has to be: a document that
 * goes into a meeting as it is, with the range it covers on the page, aligned
 * columns, a totals line and the clinic's share of each doctor as a percentage
 * rather than a raw ratio.
 *
 * Three sheets, because the questions are separate: what the period came to,
 * who earned it, and how the consultation-to-treatment split fell.
 */
reportsRouter.get("/doctors/report/export.xlsx", requirePermission("reports.export"), async (req, res, next) => {
  try {
    const query = doctorReportQuerySchema.parse({ ...req.query, limit: 500 });
    const report = await doctors.getReport(query);
    const hideMoney = displayMask(req).amounts;

    const range =
      query.from || query.to
        ? `بازه: ${query.from ?? "ابتدا"} تا ${query.to ?? "انتها"}`
        : "بازه: کل دوره ثبت‌شده";
    const scope = [
      query.serviceKind === "consultation" ? "فقط مشاوره" : null,
      query.serviceKind === "visit" ? "فقط ویزیت" : null,
      query.serviceKind === "service" ? "فقط خدمت" : null,
      query.tier ? `رتبه ${PATIENT_TIER_LABELS[query.tier] ?? query.tier}` : null,
      query.doctors?.length ? `${query.doctors.length} پزشک انتخاب‌شده` : null,
    ].filter(Boolean);
    const subtitle = scope.length ? `${range} — ${scope.join("، ")}` : range;

    const wb = createWorkbook("گزارش پزشکان");
    type Row = (typeof report.rows)[number];

    addSummarySheet(
      wb,
      {
        name: "خلاصه",
        title: "گزارش عملکرد پزشکان",
        subtitle,
        rows: [
          { label: "تعداد پزشک", value: report.totals.doctorCount, format: FMT.count },
          { label: "تعداد بیمار", value: report.totals.patientCount, format: FMT.count },
          { label: "تعداد پذیرش", value: report.totals.receptionCount, format: FMT.count },
          { label: "تعداد خط خدمت", value: report.totals.lineCount, format: FMT.count },
          { label: "درآمد کل (ریال)", value: report.totals.received, format: FMT.rial, money: true },
          { label: "تخفیف کل (ریال)", value: report.totals.discount, format: FMT.rial, money: true },
          { label: "مانده دریافت‌نشده (ریال)", value: report.totals.outstanding, format: FMT.rial, money: true },
          // Disclosed rather than hidden: a line naming two practitioners is
          // counted once for each, so per-doctor revenue sums above the clinic
          // total. The reader needs to know by how much.
          { label: "خط با بیش از یک پزشک", value: report.sharedLineCount, format: FMT.count },
          { label: "تاریخ تهیه گزارش", value: jalaliToday(), format: FMT.text },
        ],
      },
      hideMoney,
    );

    addSheet<Row>(
      wb,
      {
        name: "رتبه‌بندی پزشکان",
        title: "رتبه‌بندی پزشکان",
        subtitle,
        totals: true,
        rows: report.rows,
        columns: [
          { header: "#", width: 6, align: "center", value: (_r, i) => i + 1, format: FMT.count },
          { header: "نام پزشک", width: 34, align: "right", value: (r) => r.doctorName },
          { header: "سهم از درآمد", width: 13, value: (r) => r.revenueShare, format: FMT.percent1, money: true },
          { header: "درآمد (ریال)", width: 18, value: (r) => r.received, format: FMT.rial, money: true, total: "sum" },
          { header: "تخفیف (ریال)", width: 16, value: (r) => r.discount, format: FMT.rial, money: true, total: "sum" },
          { header: "مانده (ریال)", width: 16, value: (r) => r.outstanding, format: FMT.rial, money: true, total: "sum" },
          { header: "بیمار", width: 11, value: (r) => r.patientCount, format: FMT.count, total: "sum" },
          { header: "بیمار جدید", width: 12, value: (r) => r.newPatientCount, format: FMT.count, total: "sum" },
          { header: "پذیرش", width: 11, value: (r) => r.receptionCount, format: FMT.count, total: "sum" },
          { header: "خط خدمت", width: 11, value: (r) => r.lineCount, format: FMT.count, total: "sum" },
          { header: "میانگین هر بیمار (ریال)", width: 20, value: (r) => Math.round(r.averagePerPatient), format: FMT.rial, money: true },
          { header: "میانگین هر پذیرش (ریال)", width: 20, value: (r) => Math.round(r.averagePerReception), format: FMT.rial, money: true },
        ],
      },
      hideMoney,
    );

    addSheet<Row>(
      wb,
      {
        name: "مشاوره و ویزیت",
        title: "تفکیک مشاوره و ویزیت و خدمت",
        subtitle,
        totals: true,
        rows: report.rows,
        columns: [
          { header: "#", width: 6, align: "center", value: (_r, i) => i + 1, format: FMT.count },
          { header: "نام پزشک", width: 34, align: "right", value: (r) => r.doctorName },
          {
            header: "مشاوره و ویزیت",
            width: 15,
            value: (r) => r.consultationCount + r.visitCount,
            format: FMT.count,
            total: "sum",
          },
          { header: "مشاوره", width: 11, value: (r) => r.consultationCount, format: FMT.count, total: "sum" },
          { header: "ویزیت", width: 11, value: (r) => r.visitCount, format: FMT.count, total: "sum" },
          { header: "خدمت", width: 11, value: (r) => r.serviceCount, format: FMT.count, total: "sum" },
          { header: "بیمار", width: 11, value: (r) => r.patientCount, format: FMT.count, total: "sum" },
          { header: "بیمار جدید", width: 12, value: (r) => r.newPatientCount, format: FMT.count, total: "sum" },
          { header: "درآمد (ریال)", width: 18, value: (r) => r.received, format: FMT.rial, money: true, total: "sum" },
        ],
      },
      hideMoney,
    );

    /**
     * The same question asked of the entry services themselves.
     *
     * The sheet above answers it per doctor; this one answers it per way in, so
     * «مشاوره زیبایی» and «ویزیت» are read separately instead of averaged into a
     * rate that describes neither.
     */
    type EntryRow = (typeof report.entryConversion)[number];
    addSheet<EntryRow>(
      wb,
      {
        name: "تبدیل به خدمت",
        title: "چند درصد از مشاوره‌ها و ویزیت‌ها به خدمت رسید",
        subtitle,
        totals: true,
        rows: report.entryConversion,
        columns: [
          { header: "#", width: 6, align: "center", value: (_r, i) => i + 1, format: FMT.count },
          { header: "نوع", width: 10, align: "center", value: (r) => (r.kind === "consultation" ? "مشاوره" : "ویزیت") },
          { header: "عنوان", width: 38, align: "right", value: (r) => r.entryName },
          { header: "بیمار", width: 11, value: (r) => r.patientCount, format: FMT.count, total: "sum" },
          { header: "به خدمت رسید", width: 14, value: (r) => r.convertedCount, format: FMT.count, total: "sum" },
          { header: "نرخ تبدیل", width: 12, value: (r) => r.conversionRate, format: FMT.percent },
          { header: "درآمد خدمت (ریال)", width: 20, value: (r) => r.serviceRevenue, format: FMT.rial, money: true, total: "sum" },
        ],
      },
      hideMoney,
    );

    await sendXlsx(res, stampedXlsxName("گزارش-پزشکان", jalaliToday()), wb);
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
      { header: "پزشک خدمت", value: (r) => r.treatingDoctors.join(" | ") },
      { header: "خدمات گرفته‌شده", value: (r) => r.treatmentServices.join(" | ") },
      { header: "تعداد خدمت", value: (r) => r.treatmentCount },
      { header: "اولین خدمت", value: (r) => r.firstTreatmentDate ?? "" },
      { header: "آخرین خدمت", value: (r) => r.lastTreatmentDate ?? "" },
      { header: "درآمد خدمت (ریال)", value: (r) => r.treatmentReceived, money: true },
      { header: "درآمد پزشک مشاور (ریال)", value: (r) => r.consultingDoctorReceived, money: true },
      { header: "مجموع خرید بیمار (ریال)", value: (r) => r.lifetimeSpend, money: true },
    ], { hideMoney: displayMask(req).amounts });

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
      { header: "مجموع پرداختی (ریال)", value: (r) => r.totalReceived, money: true },
      { header: "تخفیف (ریال)", value: (r) => r.totalDiscount, money: true },
      { header: "مانده (ریال)", value: (r) => r.totalOutstanding, money: true },
      { header: "میانگین هر مراجعه (ریال)", value: (r) => Math.round(r.averageTicket), money: true },
      { header: "اولین مراجعه", value: (r) => r.firstVisitDate ?? "" },
      { header: "آخرین مراجعه", value: (r) => r.lastVisitDate ?? "" },
      { header: "روز از آخرین مراجعه", value: (r) => r.recencyDays ?? "" },
      { header: "امتیاز RFM", value: (r) => r.rfmScore },
    ], { hideMoney: displayMask(req).amounts });

    sendCsv(res, stampedFilename("رتبه‌بندی-بیماران", jalaliToday()), csv);
  } catch (e) {
    next(e);
  }
});
