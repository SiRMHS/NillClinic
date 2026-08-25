import { z } from "zod";
import { toLatinDigits } from "../utils/jalali.js";

/**
 * Financial reporting contracts.
 *
 * Every figure derives from `reception_items`, the per-line grain carrying the
 * CRM's `receivedPrice` / `discount` / `remainPrice` / `depositPrice`. Those
 * four fields were previously discarded by the reception zod schema before they
 * reached the database, so no financial reporting was possible at all.
 *
 * Amounts are Iranian rials, returned as `number`. They are summed in Postgres
 * as `numeric` and only widened to a JS number at the edge.
 */

/**
 * A Jalali date query param.
 *
 * Normalizes before validating rather than demanding an exact shape: a cleared
 * date picker sends `""`, and hand-typed or non-padded values like `1405/5/1`
 * are legitimate. Both previously failed a strict `\d{4}/\d{2}/\d{2}` regex and
 * surfaced to the user as an opaque server error.
 */
const jalaliDateParam = z.preprocess(
  (value) => {
    if (typeof value !== "string") return undefined;
    // The Persian-locale date picker emits Persian numerals (۱۴۰۵/۰۵/۲۱), which
    // no ASCII \d pattern can match — normalize before validating.
    const trimmed = toLatinDigits(value.trim());
    if (!trimmed) return undefined;
    const m = /^(\d{3,4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(trimmed);
    // Unparseable input falls through unchanged so the check below reports it.
    if (!m) return trimmed;
    return `${m[1]}/${m[2]!.padStart(2, "0")}/${m[3]!.padStart(2, "0")}`;
  },
  z
    .string()
    .regex(/^\d{3,4}\/\d{2}\/\d{2}$/, "تاریخ باید شمسی و به شکل ۱۴۰۵/۰۵/۱۹ باشد")
    .optional(),
);

/** Jalali `YYYY/MM/DD` bounds; both optional (omit for all-time). */
export const financialRangeSchema = z.object({
  from: jalaliDateParam,
  to: jalaliDateParam,
});
export type FinancialRange = z.infer<typeof financialRangeSchema>;

export const financialGranularitySchema = z.enum(["day", "month", "year"]);
export type FinancialGranularity = z.infer<typeof financialGranularitySchema>;

export const revenueSummarySchema = z.object({
  /** Cash actually collected. */
  totalReceived: z.number(),
  /** Value given away as discount. */
  totalDiscount: z.number(),
  /** Billed but still owed by patients. */
  totalOutstanding: z.number(),
  /** Prepayments held against future treatment. */
  totalDeposit: z.number(),
  /** Gross before discount (received + discount). */
  grossBilled: z.number(),
  discountRate: z.number(),
  receptionCount: z.number(),
  lineCount: z.number(),
  uniquePatients: z.number(),
  /** Mean collected per reception. */
  averageTicket: z.number(),
});
export type RevenueSummary = z.infer<typeof revenueSummarySchema>;

export const revenuePointSchema = z.object({
  /** Jalali period label: `1405/05/19`, `1405/05`, or `1405`. */
  period: z.string(),
  received: z.number(),
  discount: z.number(),
  outstanding: z.number(),
  receptionCount: z.number(),
});
export type RevenuePoint = z.infer<typeof revenuePointSchema>;

export const revenueByServiceSchema = z.object({
  serviceExternalId: z.number().nullable(),
  serviceName: z.string(),
  sectionName: z.string().nullable(),
  received: z.number(),
  discount: z.number(),
  lineCount: z.number(),
  uniquePatients: z.number(),
  averagePrice: z.number(),
});
export type RevenueByService = z.infer<typeof revenueByServiceSchema>;

export const revenueBySectionSchema = z.object({
  sectionId: z.number().nullable(),
  sectionName: z.string(),
  received: z.number(),
  discount: z.number(),
  lineCount: z.number(),
  share: z.number(),
});
export type RevenueBySection = z.infer<typeof revenueBySectionSchema>;

export const revenueByPersonnelSchema = z.object({
  personnelName: z.string(),
  received: z.number(),
  discount: z.number(),
  lineCount: z.number(),
  uniquePatients: z.number(),
  averagePerPatient: z.number(),
});
export type RevenueByPersonnel = z.infer<typeof revenueByPersonnelSchema>;

// ─── Value tiers (spend-based) ───

/**
 * Spend tiers, ordered richest first.
 *
 * Deliberately separate from `PatientSegment`. A segment answers "how is this
 * patient behaving" (RFM); a tier answers "how much has this patient been
 * worth". Collapsing the two would hide the case the clinic most wants to see:
 * a PLATINUM patient who has drifted into AT_RISK.
 */
export const patientTierSchema = z.enum(["PLATINUM", "GOLD", "SILVER", "BRONZE", "GRAY"]);
export type PatientTier = z.infer<typeof patientTierSchema>;

export const PATIENT_TIER_LABELS: Record<PatientTier, string> = {
  PLATINUM: "پلاتینیوم",
  GOLD: "طلایی",
  SILVER: "نقره‌ای",
  BRONZE: "برنز",
  GRAY: "خاکستری",
};

/** Ranking order, used wherever tiers are listed or sorted. */
export const PATIENT_TIER_ORDER: PatientTier[] = ["PLATINUM", "GOLD", "SILVER", "BRONZE", "GRAY"];

// ─── Patient ranking (RFM) ───

export const patientSegmentSchema = z.enum([
  "CHAMPION",
  "LOYAL",
  "POTENTIAL",
  "NEW",
  "AT_RISK",
  "DORMANT",
  "LOST",
]);
export type PatientSegment = z.infer<typeof patientSegmentSchema>;

/** Persian labels for the dashboard. */
export const PATIENT_SEGMENT_LABELS: Record<PatientSegment, string> = {
  CHAMPION: "بیماران ویژه",
  LOYAL: "وفادار",
  POTENTIAL: "مستعد رشد",
  NEW: "تازه‌وارد",
  AT_RISK: "در خطر ریزش",
  DORMANT: "خفته",
  LOST: "از دست رفته",
};

export const rankedPatientSchema = z.object({
  patientId: z.string(),
  patientExternalCode: z.number(),
  fullName: z.string().nullable(),
  mobile: z.string().nullable(),
  visitCount: z.number(),
  totalReceived: z.number(),
  totalDiscount: z.number(),
  totalOutstanding: z.number(),
  averageTicket: z.number(),
  firstVisitDate: z.string().nullable(),
  lastVisitDate: z.string().nullable(),
  recencyDays: z.number().nullable(),
  recencyScore: z.number(),
  frequencyScore: z.number(),
  monetaryScore: z.number(),
  /** Composite 3-digit score, e.g. 545. */
  rfmScore: z.number(),
  segment: patientSegmentSchema,
  segmentLabel: z.string(),
  tier: patientTierSchema,
  tierLabel: z.string(),
});
export type RankedPatient = z.infer<typeof rankedPatientSchema>;

export const segmentSummarySchema = z.object({
  segment: patientSegmentSchema,
  segmentLabel: z.string(),
  patientCount: z.number(),
  totalReceived: z.number(),
  revenueShare: z.number(),
  averageTicket: z.number(),
});
export type SegmentSummary = z.infer<typeof segmentSummarySchema>;

/**
 * Sortable columns for the ranking table.
 *
 * Sorting is applied server-side because the table is paginated: ordering only
 * the 50 rows on screen would present a reshuffled window as a ranking of all
 * patients.
 */
export const patientSortKeySchema = z.enum([
  "rfm",
  "revenue",
  "visits",
  "recency",
  "discount",
  "outstanding",
  "avgTicket",
  "name",
  "code",
  "tier",
]);
export type PatientSortKey = z.infer<typeof patientSortKeySchema>;

export const patientRankingQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  segment: patientSegmentSchema.optional(),
  tier: patientTierSchema.optional(),
  sort: patientSortKeySchema.default("rfm"),
  direction: z.enum(["asc", "desc"]).default("desc"),
  search: z.string().trim().min(1).optional(),
});
export type PatientRankingQuery = z.infer<typeof patientRankingQuerySchema>;

// ─── Tier thresholds & summaries ───

/** Rial thresholds. BRONZE is `0 < spend < silverMin`; GRAY is `spend <= 0`. */
export const tierSettingsSchema = z.object({
  platinumMin: z.number().nonnegative(),
  goldMin: z.number().nonnegative(),
  silverMin: z.number().nonnegative(),
  updatedAt: z.string().nullable(),
});
export type TierSettings = z.infer<typeof tierSettingsSchema>;

/**
 * Thresholds must strictly descend. Equal or inverted bounds would make a tier
 * unreachable, which surfaces as "no platinum patients" rather than as the
 * configuration error it actually is.
 */
export const tierSettingsUpdateSchema = z
  .object({
    platinumMin: z.coerce.number().nonnegative(),
    goldMin: z.coerce.number().nonnegative(),
    silverMin: z.coerce.number().nonnegative(),
  })
  .refine((v) => v.platinumMin > v.goldMin && v.goldMin > v.silverMin && v.silverMin > 0, {
    message: "آستانه‌ها باید نزولی و بزرگ‌تر از صفر باشند: پلاتینیوم > طلایی > نقره‌ای > ۰",
  });
export type TierSettingsUpdate = z.infer<typeof tierSettingsUpdateSchema>;

export const tierSummarySchema = z.object({
  tier: patientTierSchema,
  tierLabel: z.string(),
  patientCount: z.number(),
  totalReceived: z.number(),
  totalOutstanding: z.number(),
  revenueShare: z.number(),
  averageSpend: z.number(),
  /** Inclusive rial floor for the tier; null for GRAY. */
  minSpend: z.number().nullable(),
  /** Members who have not visited in over a year — the churn exposure. */
  atRiskCount: z.number(),
});
export type TierSummary = z.infer<typeof tierSummarySchema>;

// ─── Tier activity feed ───

/**
 * One thing that happened to a ranked patient: a reception that took place, or
 * an appointment that is booked. Both are folded into a single stream so the
 * page answers "what are my valuable patients doing" in one read.
 */
export const tierActivityKindSchema = z.enum(["RECEPTION", "RESERVE"]);
export type TierActivityKind = z.infer<typeof tierActivityKindSchema>;

export const tierActivitySchema = z.object({
  kind: tierActivityKindSchema,
  /** Stable per row so React keys survive refetches. */
  id: z.string(),
  patientId: z.string().nullable(),
  patientExternalCode: z.number().nullable(),
  fullName: z.string().nullable(),
  mobile: z.string().nullable(),
  tier: patientTierSchema,
  tierLabel: z.string(),
  segment: patientSegmentSchema.nullable(),
  /** Lifetime spend, so the row carries the reason it is worth attention. */
  lifetimeSpend: z.number(),
  visitCount: z.number(),
  /** Jalali `YYYY/MM/DD` of the reception or the appointment. */
  date: z.string().nullable(),
  time: z.string().nullable(),
  /** Practitioner: reception line personnel, or the appointment's doctor. */
  doctorName: z.string().nullable(),
  services: z.string().nullable(),
  /** Collected on the reception; null for an appointment. */
  amount: z.number().nullable(),
  /** Appointments only: whether the CRM has marked it attended. */
  isAccepted: z.boolean().nullable(),
  /** True when the appointment date is today or later. */
  isUpcoming: z.boolean(),
});
export type TierActivity = z.infer<typeof tierActivitySchema>;

export const tierActivityQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  /** Repeatable `tier=` params; empty means every tier. */
  tiers: z
    .preprocess(
      (v) => (v === undefined || v === "" ? undefined : Array.isArray(v) ? v : String(v).split(",")),
      z.array(patientTierSchema).optional(),
    ),
  kind: tierActivityKindSchema.optional(),
  /** Appointments only: restrict to dates from today onward. */
  upcomingOnly: z.coerce.boolean().default(false),
  from: jalaliDateParam,
  to: jalaliDateParam,
  doctor: z.string().trim().min(1).optional(),
  search: z.string().trim().min(1).optional(),
});
export type TierActivityQuery = z.infer<typeof tierActivityQuerySchema>;
