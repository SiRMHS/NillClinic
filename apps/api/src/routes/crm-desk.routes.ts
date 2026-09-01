import { Router } from "express";
import {
  CRM_CALL_RESULT_LABELS,
  CRM_CHANNEL_LABELS,
  CRM_CONTACT_KIND_LABELS,
  CRM_LIKELIHOOD_LABELS,
  CRM_RATING_LABELS,
  CRM_RISK_LABELS,
  CRM_WEEKDAYS,
  NPS_BUCKET_LABELS,
  crmContactInputSchema,
  crmContactQuerySchema,
  crmContactUpdateSchema,
  crmScheduleUpdateSchema,
  jalaliToday,
  type CrmChannel,
} from "@jordan/shared";
import { z } from "zod";
import { CrmDeskService } from "../services/crm-desk.service.js";
import { requirePermission } from "../middleware/permission.middleware.js";
import { sendCsv, stampedFilename, toCsv } from "../lib/csv.js";
import {
  CONTACT_IMPORT_HEADERS,
  SCHEDULE_IMPORT_HEADERS,
  parseContactCsv,
  parseScheduleCsv,
} from "../lib/crm-import.js";
import { displayMask } from "../middleware/display.middleware.js";

export const crmDeskRouter = Router();

const service = new CrmDeskService();

// Rows carry patient names, mobiles and what each one paid, so the whole
// router sits behind its own permission rather than authentication alone.
crmDeskRouter.use(requirePermission("crm.desk"));

// JSON responses are masked centrally — see middleware/display.middleware.ts.
// Only the CSV exports below ask `displayMask` directly, because a column has
// to be dropped rather than blanked: a header with nothing under it invites
// someone to go looking for the missing data.

/** Label maps, so the client never hard-codes a second copy of the enums. */
crmDeskRouter.get("/meta", async (_req, res, next) => {
  try {
    const [doctors, serviceCatalogue] = await Promise.all([
      service.doctorNames(),
      service.serviceCatalogue(),
    ]);
    res.json({
      kinds: CRM_CONTACT_KIND_LABELS,
      ratings: CRM_RATING_LABELS,
      likelihoods: CRM_LIKELIHOOD_LABELS,
      callResults: CRM_CALL_RESULT_LABELS,
      channels: CRM_CHANNEL_LABELS,
      risks: CRM_RISK_LABELS,
      npsBuckets: NPS_BUCKET_LABELS,
      doctors,
      // The entry form's service picker. Sent with the rest of the reference
      // data rather than fetched on dialog open, so opening the form is not a
      // round trip for a list that changes when the clinic adds a procedure.
      serviceCatalogue,
    });
  } catch (e) {
    next(e);
  }
});

// ─── Contacts ───

crmDeskRouter.get("/contacts", async (req, res, next) => {
  try {
    res.json(await service.list(crmContactQuerySchema.parse(req.query)));
  } catch (e) {
    next(e);
  }
});

/**
 * The export is the whole filtered set, not the page on screen — a report that
 * silently stops at the current window is worse than no export.
 */
crmDeskRouter.get("/contacts/export", requirePermission("reports.export"), async (req, res, next) => {
  try {
    const query = crmContactQuerySchema.parse(req.query);
    const rows = await service.listAll(query);
    // The export is the one place a masked figure could walk out of the
    // building, so the column is dropped rather than blanked — a header with
    // nothing under it invites someone to go looking for the missing data.
    const noAmounts = displayMask(req).amounts;

    const channelText = (channels: CrmChannel[]) =>
      channels.map((c) => CRM_CHANNEL_LABELS[c]).join("، ");

    const csv = toCsv(rows, [
      { header: "نوع", value: (r) => CRM_CONTACT_KIND_LABELS[r.kind] },
      { header: "شماره پرونده بیمار", value: (r) => r.patientExternalCode ?? "" },
      { header: "نام بیمار", value: (r) => r.patientName ?? "" },
      { header: "موبایل", value: (r) => r.patientMobile ?? "" },
      { header: "نام پزشک", value: (r) => r.doctorName ?? "" },
      { header: "تاریخ مراجعه", value: (r) => r.visitDate ?? "" },
      { header: "تاریخ تماس", value: (r) => r.contactDate },
      { header: "خدمات انجام شده", value: (r) => r.serviceName ?? "" },
      ...(noAmounts
        ? []
        : [{ header: "مبلغ دریافت شده", value: (r: (typeof rows)[number]) => r.amountText ?? (r.amount ?? "") }]),
      { header: "وقت‌دهی", value: (r) => (r.schedulingRating ? CRM_RATING_LABELS[r.schedulingRating] : "") },
      { header: "پزشک", value: (r) => (r.doctorRating ? CRM_RATING_LABELS[r.doctorRating] : "") },
      { header: "دستیار", value: (r) => (r.assistantRating ? CRM_RATING_LABELS[r.assistantRating] : "") },
      { header: "پذیرش", value: (r) => (r.receptionRating ? CRM_RATING_LABELS[r.receptionRating] : "") },
      { header: "بهداشت", value: (r) => (r.hygieneRating ? CRM_RATING_LABELS[r.hygieneRating] : "") },
      { header: "رضایت کلی (٪)", value: (r) => r.satisfaction ?? "" },
      { header: "احتمال معرفی به دیگران", value: (r) => (r.referralLikelihood ? CRM_LIKELIHOOD_LABELS[r.referralLikelihood] : "") },
      { header: "شاخص NPS", value: (r) => (r.npsBucket ? NPS_BUCKET_LABELS[r.npsBucket] : "") },
      { header: "احتمال مراجعه مجدد", value: (r) => (r.revisitLikelihood ? CRM_LIKELIHOOD_LABELS[r.revisitLikelihood] : "") },
      { header: "نحوه آشنایی", value: (r) => channelText(r.channels) },
      { header: "ریسک ریزش (٪)", value: (r) => r.churnRisk ?? "" },
      { header: "سطح ریسک", value: (r) => (r.riskLevel ? CRM_RISK_LABELS[r.riskLevel] : "") },
      { header: "امتیاز وفاداری", value: (r) => r.loyalty ?? "" },
      { header: "پاسخگویی", value: (r) => (r.callResult ? CRM_CALL_RESULT_LABELS[r.callResult] : "") },
      { header: "پیشنهاد", value: (r) => r.suggestion ?? "" },
      { header: "توضیحات", value: (r) => r.notes ?? "" },
      { header: "وقت مجدد", value: (r) => r.rebookNote ?? "" },
      { header: "بروز نتایج", value: (r) => r.resultsOnset ?? "" },
      { header: "عوارض", value: (r) => r.sideEffect ?? "" },
      { header: "نظر کلی", value: (r) => r.overallOpinion ?? "" },
      { header: "درد/ورم", value: (r) => r.painSwelling ?? "" },
      { header: "تاخیر", value: (r) => r.delayComplaint ?? "" },
      { header: "نکته مثبت", value: (r) => r.positiveNote ?? "" },
      { header: "ارجاع به پزشک", value: (r) => r.referredDoctorName ?? "" },
      { header: "توضیح ارجاع", value: (r) => r.doctorReferral ?? "" },
      { header: "درمان توسط", value: (r) => r.treatmentDoctorName ?? "" },
      { header: "خدمات گرفته‌شده", value: (r) => r.treatmentServiceNames.join("، ") },
      { header: "تاریخ درمان", value: (r) => r.treatmentDate ?? "" },
      { header: "خلاصه حرف بیمار", value: (r) => r.patientSummary ?? "" },
      { header: "ارجاع به کال‌سنتر", value: (r) => r.callCenterReferral ?? "" },
      { header: "تاریخ رضایت‌سنجی مجدد", value: (r) => r.resurveyDate ?? "" },
      { header: "نتیجه رضایت‌سنجی مجدد", value: (r) => r.resurveyResult ?? "" },
      { header: "ثبت‌کننده", value: (r) => r.createdBy?.fullName ?? "" },
    ]);

    sendCsv(res, stampedFilename("گزارش-CRM", jalaliToday()), csv);
  } catch (e) {
    next(e);
  }
});

crmDeskRouter.post("/contacts", requirePermission("crm.desk.manage"), async (req, res, next) => {
  try {
    const input = crmContactInputSchema.parse(req.body);
    res.status(201).json(await service.create(input, req.user?.sub ?? null));
  } catch (e) {
    next(e);
  }
});

crmDeskRouter.get("/contacts/:id", async (req, res, next) => {
  try {
    const row = await service.get(req.params.id);
    if (!row) {
      res.status(404).json({ error: "تماس یافت نشد" });
      return;
    }
    res.json(row);
  } catch (e) {
    next(e);
  }
});

crmDeskRouter.patch("/contacts/:id", requirePermission("crm.desk.manage"), async (req, res, next) => {
  try {
    const input = crmContactUpdateSchema.parse(req.body);
    const row = await service.update(req.params.id, input);
    if (!row) {
      res.status(404).json({ error: "تماس یافت نشد" });
      return;
    }
    res.json(row);
  } catch (e) {
    next(e);
  }
});

crmDeskRouter.delete("/contacts/:id", requirePermission("crm.desk.manage"), async (req, res, next) => {
  try {
    const ok = await service.remove(req.params.id);
    if (!ok) {
      res.status(404).json({ error: "تماس یافت نشد" });
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// ─── Aggregates ───

crmDeskRouter.get("/kpi", async (req, res, next) => {
  try {
    const { from, to, kind } = crmContactQuerySchema.parse(req.query);
    res.json(await service.kpi({ from, to, kind }));
  } catch (e) {
    next(e);
  }
});

crmDeskRouter.get("/doctor-scores", async (req, res, next) => {
  try {
    const { from, to, kind } = crmContactQuerySchema.parse(req.query);
    res.json(await service.doctorScores({ from, to, kind }));
  } catch (e) {
    next(e);
  }
});

crmDeskRouter.get("/doctor-scores/export", requirePermission("reports.export"), async (req, res, next) => {
  try {
    const { from, to, kind } = crmContactQuerySchema.parse(req.query);
    const rows = await service.doctorScores({ from, to, kind });
    const noAmounts = displayMask(req).amounts;

    const csv = toCsv(rows, [
      { header: "نام پزشک", value: (r) => r.doctorName },
      { header: "تعداد تماس", value: (r) => r.contacts },
      { header: "تعداد مراجعین", value: (r) => r.patients },
      { header: "رضایت کلی (٪)", value: (r) => r.satisfaction ?? "" },
      { header: "میانگین وقت‌دهی", value: (r) => r.scheduling ?? "" },
      { header: "میانگین پذیرش", value: (r) => r.reception ?? "" },
      { header: "میانگین دستیاران", value: (r) => r.assistant ?? "" },
      { header: "میانگین پزشک", value: (r) => r.doctor ?? "" },
      { header: "میانگین بهداشت", value: (r) => r.hygiene ?? "" },
      { header: "امتیاز NPS", value: (r) => r.nps ?? "" },
      { header: "ریسک ریزش (٪)", value: (r) => r.churnRisk ?? "" },
      { header: "تعداد پرریسک", value: (r) => r.highRiskCount },
      { header: "امتیاز وفاداری", value: (r) => r.loyalty ?? "" },
      { header: "VIP", value: (r) => (r.vip ? "بله" : "خیر") },
      ...(noAmounts ? [] : [{ header: "درآمد (ریال)", value: (r: (typeof rows)[number]) => r.revenue }]),
    ]);

    sendCsv(res, stampedFilename("امتیازدهی-پزشکان-CRM", jalaliToday()), csv);
  } catch (e) {
    next(e);
  }
});

// ─── Referral after consultation ───
//
// Counts and doctor names only — no money passes through here, so it is not
// masked. The amounts version of this question is /api/reports/referrals.

crmDeskRouter.get("/referrals", async (req, res, next) => {
  try {
    const { from, to, kind } = crmContactQuerySchema.parse(req.query);
    res.json(await service.referrals({ from, to, kind }));
  } catch (e) {
    next(e);
  }
});

crmDeskRouter.get("/referrals/export", requirePermission("reports.export"), async (req, res, next) => {
  try {
    const { from, to, kind } = crmContactQuerySchema.parse(req.query);
    const report = await service.referrals({ from, to, kind });

    const names = (list: { name: string; count: number }[]) =>
      list.map((e) => `${e.name} (${e.count})`).join(" | ");

    const csv = toCsv(report.byDoctor, [
      { header: "پزشک ارجاع‌شده", value: (r) => r.referredDoctorName },
      { header: "تعداد ارجاع", value: (r) => r.referrals },
      { header: "تعداد بیمار", value: (r) => r.patients },
      { header: "درمان انجام‌شده", value: (r) => r.treated },
      { header: "در انتظار درمان", value: (r) => r.pending },
      { header: "نرخ انجام (٪)", value: (r) => r.completionRate ?? "" },
      { header: "ارجاع‌دهنده", value: (r) => names(r.fromDoctors) },
      { header: "درمان توسط", value: (r) => names(r.treatedBy) },
      { header: "خدمات گرفته‌شده", value: (r) => names(r.services) },
    ]);

    sendCsv(res, stampedFilename("گزارش-ارجاع-CRM", jalaliToday()), csv);
  } catch (e) {
    next(e);
  }
});

// ─── Doctor weekday schedule ───

crmDeskRouter.get("/schedule", async (_req, res, next) => {
  try {
    res.json(await service.schedule());
  } catch (e) {
    next(e);
  }
});

crmDeskRouter.put("/schedule", requirePermission("crm.desk.manage"), async (req, res, next) => {
  try {
    const { entries } = crmScheduleUpdateSchema.parse(req.body ?? {});
    res.json(await service.saveSchedule(entries));
  } catch (e) {
    next(e);
  }
});

// ─── Schedule export ───

crmDeskRouter.get("/schedule/export", requirePermission("reports.export"), async (_req, res, next) => {
  try {
    const rows = await service.schedule();

    // Exported as the grid the desk edits, not as one line per cell: a
    // cell-per-line file does not look like the board the clinic keeps, and the
    // grid is what they hand back when they want it changed.
    const byDoctor = new Map<string, (string | null)[]>();
    for (const row of rows) {
      const week = byDoctor.get(row.doctorName) ?? CRM_WEEKDAYS.map(() => null);
      week[row.weekday] = row.note;
      byDoctor.set(row.doctorName, week);
    }

    const grid = [...byDoctor.entries()]
      .sort(([a], [b]) => a.localeCompare(b, "fa"))
      .map(([doctorName, week]) => ({ doctorName, week }));

    const csv = toCsv(grid, [
      { header: "نام پزشک", value: (r) => r.doctorName },
      ...CRM_WEEKDAYS.map((day, weekday) => ({
        header: day,
        value: (r: (typeof grid)[number]) => r.week[weekday] ?? "",
      })),
    ]);

    sendCsv(res, stampedFilename("برنامه-هفتگی-پزشکان", jalaliToday()), csv);
  } catch (e) {
    next(e);
  }
});

// ─── Import ───
//
// Two steps on purpose. A CRM row carries a patient's name, mobile and what
// they paid, and an import that writes on upload gives the operator no moment
// to notice that Excel re-encoded a column or that they picked last month's
// file. `preview` only parses and reports; `commit` re-parses the same text
// server-side rather than trusting a row list the browser sends back, so what
// is stored is what the file says.

const importBodySchema = z.object({
  csv: z.string().min(1, "فایل خالی است").max(12_000_000),
});

const scheduleImportBodySchema = importBodySchema.extend({
  /** merge: only the doctors named in the file change. replace: the file is the schedule. */
  mode: z.enum(["merge", "replace"]).default("merge"),
});

/** Rows one upload may carry — a full export is 5000, and this leaves headroom. */
const IMPORT_ROW_CAP = 6000;

function templateCsv(headers: string[]): string {
  return toCsv([], headers.map((header) => ({ header, value: () => "" })));
}

crmDeskRouter.get("/import/contacts/template", (_req, res) => {
  sendCsv(res, "قالب-ورود-تماس-CRM.csv", templateCsv(CONTACT_IMPORT_HEADERS));
});

crmDeskRouter.get("/import/schedule/template", (_req, res) => {
  sendCsv(res, "قالب-برنامه-هفتگی-پزشکان.csv", templateCsv(SCHEDULE_IMPORT_HEADERS));
});

crmDeskRouter.post(
  "/import/contacts/preview",
  requirePermission("crm.desk.manage"),
  async (req, res, next) => {
    try {
      const { csv } = importBodySchema.parse(req.body ?? {});
      const preview = parseContactCsv(csv);
      if (preview.rows.length > IMPORT_ROW_CAP) {
        res.status(400).json({
          error: `فایل ${preview.rows.length} سطر دارد؛ حداکثر ${IMPORT_ROW_CAP} سطر در هر بار قابل ورود است`,
        });
        return;
      }
      res.json(preview);
    } catch (e) {
      if (e instanceof Error && !(e instanceof z.ZodError)) {
        res.status(400).json({ error: e.message });
        return;
      }
      next(e);
    }
  },
);

crmDeskRouter.post(
  "/import/contacts/commit",
  requirePermission("crm.desk.manage"),
  async (req, res, next) => {
    try {
      const { csv } = importBodySchema.parse(req.body ?? {});
      const preview = parseContactCsv(csv);
      if (preview.rows.length > IMPORT_ROW_CAP) {
        res.status(400).json({
          error: `فایل ${preview.rows.length} سطر دارد؛ حداکثر ${IMPORT_ROW_CAP} سطر در هر بار قابل ورود است`,
        });
        return;
      }

      const valid = preview.rows.flatMap((r) => (r.data ? [r.data] : []));
      const imported = await service.createMany(valid, req.user?.sub ?? null);

      res.json({
        imported,
        skipped: preview.summary.invalid,
        warnings: preview.summary.warnings,
      });
    } catch (e) {
      if (e instanceof Error && !(e instanceof z.ZodError)) {
        res.status(400).json({ error: e.message });
        return;
      }
      next(e);
    }
  },
);

crmDeskRouter.post(
  "/import/schedule/preview",
  requirePermission("crm.desk.manage"),
  async (req, res, next) => {
    try {
      const { csv } = scheduleImportBodySchema.parse(req.body ?? {});
      res.json(parseScheduleCsv(csv));
    } catch (e) {
      if (e instanceof Error && !(e instanceof z.ZodError)) {
        res.status(400).json({ error: e.message });
        return;
      }
      next(e);
    }
  },
);

crmDeskRouter.post(
  "/import/schedule/commit",
  requirePermission("crm.desk.manage"),
  async (req, res, next) => {
    try {
      const { csv, mode } = scheduleImportBodySchema.parse(req.body ?? {});
      const preview = parseScheduleCsv(csv);
      const entries = preview.rows.flatMap((r) => r.data ?? []);
      await service.mergeSchedule(entries, mode);

      res.json({
        imported: entries.length,
        doctors: new Set(entries.map((e) => e.doctorName)).size,
        skipped: preview.summary.invalid,
      });
    } catch (e) {
      if (e instanceof Error && !(e instanceof z.ZodError)) {
        res.status(400).json({ error: e.message });
        return;
      }
      next(e);
    }
  },
);
