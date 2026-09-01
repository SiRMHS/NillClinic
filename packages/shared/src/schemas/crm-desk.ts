import { z } from "zod";

/**
 * CRM follow-up desk — the domain the clinic used to run in a spreadsheet.
 *
 * The workbook it replaces held one sheet per month of follow-up calls plus a
 * survey sheet, a Renuvion sheet and a walk-in complaints sheet, all sharing
 * the same spine (patient, doctor, visit date, call date, five satisfaction
 * ratings, notes). Modelling that as one contact table with a `kind`
 * discriminator keeps a month from becoming a schema change, which is exactly
 * what forced a new sheet every time in the spreadsheet.
 */

export const crmContactKindSchema = z.enum([
  "FOLLOW_UP", // تماس فالوآپ — the monthly call sheets
  "SURVEY", // نظرسنجی — the SMS satisfaction form
  "CONSULT", // مشاوره کاشت — hair-transplant consultation callbacks
  "RENUVION", // مراجعین رنوویون — device-specific outcome tracking
  "WALK_IN", // مراجعین حضوری — complaints raised at the desk
]);
export type CrmContactKind = z.infer<typeof crmContactKindSchema>;

export const CRM_CONTACT_KIND_LABELS: Record<CrmContactKind, string> = {
  FOLLOW_UP: "تماس فالوآپ",
  SURVEY: "نظرسنجی",
  CONSULT: "مشاوره کاشت",
  RENUVION: "مراجعین رنوویون",
  WALK_IN: "مراجعین حضوری",
};

/** عالی / خوب / متوسط / بد / خیلی بد — the five-point scale used on every rating column. */
export const crmRatingSchema = z.enum(["EXCELLENT", "GOOD", "AVERAGE", "POOR", "VERY_POOR"]);
export type CrmRating = z.infer<typeof crmRatingSchema>;

export const CRM_RATING_LABELS: Record<CrmRating, string> = {
  EXCELLENT: "عالی",
  GOOD: "خوب",
  AVERAGE: "متوسط",
  POOR: "بد",
  VERY_POOR: "خیلی بد",
};

export const CRM_RATING_SCORE: Record<CrmRating, number> = {
  EXCELLENT: 5,
  GOOD: 4,
  AVERAGE: 3,
  POOR: 2,
  VERY_POOR: 1,
};

/** خیلی زیاد / زیاد / متوسط / کم / خیلی کم — likelihood of referring and of returning. */
export const crmLikelihoodSchema = z.enum(["VERY_HIGH", "HIGH", "MEDIUM", "LOW", "VERY_LOW"]);
export type CrmLikelihood = z.infer<typeof crmLikelihoodSchema>;

export const CRM_LIKELIHOOD_LABELS: Record<CrmLikelihood, string> = {
  VERY_HIGH: "خیلی زیاد",
  HIGH: "زیاد",
  MEDIUM: "متوسط",
  LOW: "کم",
  VERY_LOW: "خیلی کم",
};

export const CRM_LIKELIHOOD_SCORE: Record<CrmLikelihood, number> = {
  VERY_HIGH: 5,
  HIGH: 4,
  MEDIUM: 3,
  LOW: 2,
  VERY_LOW: 1,
};

/** پاسخگویی — what happened when the number was dialled. */
export const crmCallResultSchema = z.enum([
  "ANSWERED", // پاسخ داد
  "NO_ANSWER", // جواب نداد
  "UNREACHABLE", // خاموش / در دسترس نبود
  "UNAVAILABLE", // نبود — someone answered, the patient was not there
  "WRONG_NUMBER", // شماره اشتباه
]);
export type CrmCallResult = z.infer<typeof crmCallResultSchema>;

export const CRM_CALL_RESULT_LABELS: Record<CrmCallResult, string> = {
  ANSWERED: "پاسخ داد",
  NO_ANSWER: "جواب نداد",
  UNREACHABLE: "خاموش / در دسترس نبود",
  UNAVAILABLE: "نبود",
  WRONG_NUMBER: "شماره اشتباه",
};

/** نحوه آشنایی — acquisition channel. Multi-valued: patients tick more than one. */
export const crmChannelSchema = z.enum([
  "FRIENDS", // معرفی دوستان
  "SITE", // سایت
  "INSTAGRAM", // اینستاگرام
  "TV", // تلویزیون
  "PREVIOUS_PATIENT", // بیمار قبلی
  "OTHER_ADS", // سایر تبلیغات
]);
export type CrmChannel = z.infer<typeof crmChannelSchema>;

export const CRM_CHANNEL_LABELS: Record<CrmChannel, string> = {
  FRIENDS: "معرفی دوستان",
  SITE: "سایت",
  INSTAGRAM: "اینستاگرام",
  TV: "تلویزیون",
  PREVIOUS_PATIENT: "بیمار قبلی",
  OTHER_ADS: "سایر تبلیغات",
};

/** The five rating columns, in the order the spreadsheet lists them. */
export const CRM_RATING_FIELDS = [
  { key: "schedulingRating", label: "وقت‌دهی" },
  { key: "doctorRating", label: "پزشک" },
  { key: "assistantRating", label: "دستیار" },
  { key: "receptionRating", label: "پذیرش" },
  { key: "hygieneRating", label: "بهداشت" },
] as const;

export type CrmRatingField = (typeof CRM_RATING_FIELDS)[number]["key"];

// ─── Scoring ───

export interface CrmRatingSet {
  schedulingRating?: CrmRating | null;
  doctorRating?: CrmRating | null;
  assistantRating?: CrmRating | null;
  receptionRating?: CrmRating | null;
  hygieneRating?: CrmRating | null;
}

/**
 * Mean of whichever ratings were filled in, on the original 1–5 scale.
 *
 * Missing cells are skipped rather than counted as zero: an unanswered call
 * leaves every rating blank, and averaging those in would drag a doctor's
 * score down for calls that never happened.
 */
export function averageRating(row: CrmRatingSet): number | null {
  const scores = CRM_RATING_FIELDS.map(({ key }) => row[key])
    .filter((r): r is CrmRating => Boolean(r))
    .map((r) => CRM_RATING_SCORE[r]);
  if (scores.length === 0) return null;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

/** Satisfaction as a percentage, so it reads next to the other KPI tiles. */
export function satisfactionPercent(row: CrmRatingSet): number | null {
  const avg = averageRating(row);
  return avg === null ? null : Math.round((avg / 5) * 1000) / 10;
}

export type NpsBucket = "PROMOTER" | "PASSIVE" | "DETRACTOR";

export const NPS_BUCKET_LABELS: Record<NpsBucket, string> = {
  PROMOTER: "مروج",
  PASSIVE: "خنثی",
  DETRACTOR: "منتقد",
};

export function npsBucket(likelihood: CrmLikelihood | null | undefined): NpsBucket | null {
  if (!likelihood) return null;
  if (likelihood === "VERY_HIGH" || likelihood === "HIGH") return "PROMOTER";
  if (likelihood === "MEDIUM") return "PASSIVE";
  return "DETRACTOR";
}

/** Standard NPS: %promoters − %detractors, on −100…100. Passives count only in the base. */
export function npsScore(likelihoods: (CrmLikelihood | null | undefined)[]): number | null {
  const buckets = likelihoods.map(npsBucket).filter((b): b is NpsBucket => b !== null);
  if (buckets.length === 0) return null;
  const promoters = buckets.filter((b) => b === "PROMOTER").length;
  const detractors = buckets.filter((b) => b === "DETRACTOR").length;
  return Math.round(((promoters - detractors) / buckets.length) * 100);
}

export type CrmRiskLevel = "LOW" | "MEDIUM" | "HIGH";

export const CRM_RISK_LABELS: Record<CrmRiskLevel, string> = {
  LOW: "کم",
  MEDIUM: "متوسط",
  HIGH: "زیاد",
};

/**
 * Churn risk on 0–100.
 *
 * Weighted 60/40 towards the patient's own stated intent to come back, with
 * measured satisfaction as the corroborating signal — a patient who rates
 * everything "عالی" but says they are unlikely to return is still a risk, and
 * the spreadsheet's `ریسک ریزش` column was filled in on exactly that reading.
 */
export function churnRisk(
  row: CrmRatingSet & { revisitLikelihood?: CrmLikelihood | null },
): number | null {
  const avg = averageRating(row);
  const revisit = row.revisitLikelihood ? CRM_LIKELIHOOD_SCORE[row.revisitLikelihood] : null;
  if (avg === null && revisit === null) return null;

  const parts: { value: number; weight: number }[] = [];
  if (revisit !== null) parts.push({ value: (5 - revisit) / 4, weight: 60 });
  if (avg !== null) parts.push({ value: (5 - avg) / 4, weight: 40 });

  const totalWeight = parts.reduce((s, p) => s + p.weight, 0);
  const weighted = parts.reduce((s, p) => s + p.value * p.weight, 0);
  return Math.round((weighted / totalWeight) * 100);
}

export function riskLevel(risk: number | null): CrmRiskLevel | null {
  if (risk === null) return null;
  if (risk >= 60) return "HIGH";
  if (risk >= 30) return "MEDIUM";
  return "LOW";
}

/**
 * Loyalty on 0–100: half how the visit went, half what the patient says they
 * will do next — refer, and return.
 */
export function loyaltyScore(
  row: CrmRatingSet & {
    referralLikelihood?: CrmLikelihood | null;
    revisitLikelihood?: CrmLikelihood | null;
  },
): number | null {
  const avg = averageRating(row);
  const referral = row.referralLikelihood ? CRM_LIKELIHOOD_SCORE[row.referralLikelihood] : null;
  const revisit = row.revisitLikelihood ? CRM_LIKELIHOOD_SCORE[row.revisitLikelihood] : null;
  if (avg === null && referral === null && revisit === null) return null;

  const parts: { value: number; weight: number }[] = [];
  if (avg !== null) parts.push({ value: avg / 5, weight: 50 });
  if (referral !== null) parts.push({ value: referral / 5, weight: 25 });
  if (revisit !== null) parts.push({ value: revisit / 5, weight: 25 });

  const totalWeight = parts.reduce((s, p) => s + p.weight, 0);
  const weighted = parts.reduce((s, p) => s + p.value * p.weight, 0);
  return Math.round((weighted / totalWeight) * 100);
}

// ─── Request schemas ───

const jalaliDate = z
  .string()
  .regex(/^\d{4}\/\d{1,2}\/\d{1,2}$/, "تاریخ باید به صورت ۱۴۰۵/۰۵/۳۰ باشد");

const optionalText = z.string().trim().max(2000).optional().nullable();

export const crmContactInputSchema = z.object({
  kind: crmContactKindSchema.default("FOLLOW_UP"),

  patientId: z.string().cuid().optional().nullable(),
  patientExternalCode: z.coerce.number().int().positive().optional().nullable(),
  patientName: z.string().trim().min(1).max(200).optional().nullable(),
  patientMobile: z.string().trim().max(20).optional().nullable(),
  doctorName: z.string().trim().max(200).optional().nullable(),

  visitDate: jalaliDate.optional().nullable(),
  contactDate: jalaliDate,

  /**
   * The services as one string. Derived from `serviceNames` when those are
   * given, so a client that only sends the picked list never has to build the
   * text itself — and rows imported from the spreadsheet keep their prose.
   */
  serviceName: optionalText,
  /** Services picked from the clinic's catalogue. */
  serviceNames: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
  /** The spreadsheet recorded amounts as prose ("۱۰ میلیون و ۹۰۰ هزار تومان"). */
  amountText: optionalText,
  amount: z.coerce.number().nonnegative().optional().nullable(),

  schedulingRating: crmRatingSchema.optional().nullable(),
  doctorRating: crmRatingSchema.optional().nullable(),
  assistantRating: crmRatingSchema.optional().nullable(),
  receptionRating: crmRatingSchema.optional().nullable(),
  hygieneRating: crmRatingSchema.optional().nullable(),

  referralLikelihood: crmLikelihoodSchema.optional().nullable(),
  revisitLikelihood: crmLikelihoodSchema.optional().nullable(),
  channels: z.array(crmChannelSchema).default([]),

  callResult: crmCallResultSchema.optional().nullable(),
  suggestion: optionalText,
  notes: optionalText,
  rebookNote: optionalText,

  // Renuvion outcome tracking
  resultsOnset: optionalText,
  sideEffect: optionalText,
  overallOpinion: optionalText,

  // The richer "جزییات تماس" template the clinic was moving towards
  painSwelling: optionalText,
  delayComplaint: optionalText,
  positiveNote: optionalText,
  /** Why the patient was referred on — the note beside `referredDoctorName`. */
  doctorReferral: optionalText,
  patientSummary: optionalText,
  callCenterReferral: optionalText,
  resurveyDate: jalaliDate.optional().nullable(),
  resurveyResult: optionalText,

  // ─── Referral after consultation ───
  /** The doctor the patient was referred to. */
  referredDoctorName: z.string().trim().max(200).optional().nullable(),
  /** The doctor who actually delivered the referred treatment. */
  treatmentDoctorName: z.string().trim().max(200).optional().nullable(),
  /** What the patient received from that treatment. */
  treatmentServiceNames: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
  treatmentDate: jalaliDate.optional().nullable(),
});

export type CrmContactInput = z.infer<typeof crmContactInputSchema>;

export const crmContactUpdateSchema = crmContactInputSchema.partial();

export const crmContactQuerySchema = z.object({
  kind: crmContactKindSchema.optional(),
  from: jalaliDate.optional(),
  to: jalaliDate.optional(),
  doctorName: z.string().trim().optional(),
  /** Narrows to contacts referred on to this doctor. */
  referredDoctorName: z.string().trim().optional(),
  /** Narrows to contacts naming this service, on either the visit or the referral. */
  serviceName: z.string().trim().optional(),
  callResult: crmCallResultSchema.optional(),
  /** "risky" narrows to the rows the desk is meant to act on today. */
  segment: z
    .enum([
      "all",
      "risky",
      "unanswered",
      "rebook",
      "promoters",
      "detractors",
      /** Referred on to a named doctor, whatever came of it. */
      "referred",
      /** Referred on and the treatment is still not recorded — the desk's queue. */
      "referred-pending",
    ])
    .default("all"),
  search: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export type CrmContactQuery = z.infer<typeof crmContactQuerySchema>;

export const crmScheduleUpdateSchema = z.object({
  entries: z.array(
    z.object({
      doctorName: z.string().trim().min(1).max(200),
      /** 0 = شنبه … 6 = جمعه, matching the Jalali week the sheet was laid out on. */
      weekday: z.number().int().min(0).max(6),
      note: z.string().trim().max(200).nullable(),
    }),
  ),
});

export const CRM_WEEKDAYS = [
  "شنبه",
  "یکشنبه",
  "دوشنبه",
  "سه‌شنبه",
  "چهارشنبه",
  "پنج‌شنبه",
  "جمعه",
] as const;
