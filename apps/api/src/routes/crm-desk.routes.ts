import { Router } from "express";
import {
  CRM_CALL_RESULT_LABELS,
  CRM_CHANNEL_LABELS,
  CRM_CONTACT_KIND_LABELS,
  CRM_LIKELIHOOD_LABELS,
  CRM_RATING_LABELS,
  CRM_RISK_LABELS,
  NPS_BUCKET_LABELS,
  crmContactInputSchema,
  crmContactQuerySchema,
  crmContactUpdateSchema,
  crmScheduleUpdateSchema,
  jalaliToday,
  type CrmChannel,
} from "@jordan/shared";
import { CrmDeskService } from "../services/crm-desk.service.js";
import { requirePermission } from "../middleware/permission.middleware.js";
import { sendCsv, stampedFilename, toCsv } from "../lib/csv.js";

export const crmDeskRouter = Router();

const service = new CrmDeskService();

// Rows carry patient names, mobiles and what each one paid, so the whole
// router sits behind its own permission rather than authentication alone.
crmDeskRouter.use(requirePermission("crm.desk"));

/** Label maps, so the client never hard-codes a second copy of the enums. */
crmDeskRouter.get("/meta", async (_req, res, next) => {
  try {
    res.json({
      kinds: CRM_CONTACT_KIND_LABELS,
      ratings: CRM_RATING_LABELS,
      likelihoods: CRM_LIKELIHOOD_LABELS,
      callResults: CRM_CALL_RESULT_LABELS,
      channels: CRM_CHANNEL_LABELS,
      risks: CRM_RISK_LABELS,
      npsBuckets: NPS_BUCKET_LABELS,
      doctors: await service.doctorNames(),
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
      { header: "مبلغ دریافت شده", value: (r) => r.amountText ?? (r.amount ?? "") },
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
      { header: "ارجاع به پزشک", value: (r) => r.doctorReferral ?? "" },
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
      { header: "درآمد (ریال)", value: (r) => r.revenue },
    ]);

    sendCsv(res, stampedFilename("امتیازدهی-پزشکان-CRM", jalaliToday()), csv);
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
