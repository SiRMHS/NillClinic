import { z } from "zod";
import { financialRangeSchema, patientTierSchema } from "./financial.js";

/**
 * Doctor and referral reporting contracts.
 *
 * ## Which column is "the doctor"
 *
 * `receptions.user_name` is the front-desk operator who registered the visit
 * (ستاره کازرونی, نسیمه فلاح …), not a practitioner. The clinician who actually
 * performed the work is `reception_items.personnel_name`, at the line grain.
 * Every report here therefore runs on `reception_items`, which is also the only
 * place the money lives.
 *
 * ## Why the name has to be split
 *
 * `personnel_name` is multi-valued: ~1.3k lines carry two practitioners joined
 * by an Arabic comma (`محمد علی نیلفروش زاده، فرناز محسن پور`). Grouping on the
 * raw column invents a third "doctor" whose name is the pair, and drops those
 * lines from both real doctors' totals. The reports unnest the split instead.
 *
 * That means a two-practitioner line is counted once for each of them, so
 * summing revenue across doctors slightly exceeds clinic revenue. That is the
 * honest representation of shared work — the alternative is silently crediting
 * one of the two — and the affected share is disclosed on the report.
 */

/**
 * Values that appear in `personnel_name` but are not people: service names
 * leaking into the practitioner column (`مشاوره کاشت`, `کاشت ابرو`), and
 * acquisition-source rows the CRM prefixes with a dot (`. اینستاگرام`).
 *
 * Kept here rather than in the SQL so the API and the UI agree on who counts
 * as a doctor.
 */
export const NON_DOCTOR_NAME_PATTERNS = [
  "مشاوره%",
  "کاشت%",
  "مراقب%",
  "پروسیجر%",
  ".%",
] as const;

/**
 * The two kinds of entry-point line, and everything else.
 *
 * The clinic's funnel is visible in the service catalogue itself: a line named
 * ویزیت or مشاوره is a way *in* — the patient is being seen, nothing has been
 * performed yet — and every other line is the work the clinic actually sells.
 * The reports say خدمت for that third group rather than «درمان», because that
 * is the word the catalogue, the receipt and the desk all use for it.
 *
 * ویزیت used to fall on the «درمان» side of a two-way split, which counted the
 * clinic's single most common line (~36k of them) as delivered work and pushed
 * every conversion figure the wrong way. It is its own class here, reported
 * beside مشاوره rather than folded into it, because «چند درصد از ویزیت‌ها به
 * خدمت رسید» is a different question from the same one about مشاوره.
 */
export const CONSULTATION_SERVICE_PATTERN = "%مشاوره%";
export const VISIT_SERVICE_PATTERN = "%ویزیت%";

/**
 * The same two classes as regexes, for the queries that classify every line in
 * range rather than filtering to one class.
 *
 * `service_name ~ 'مشاوره|ویزیت'` is one pass where two `ILIKE '%…%'` tests are
 * two, and neither form can use an index — on the clinic's 400k lines that is
 * the difference between two seconds and six.
 */
export const CONSULTATION_SERVICE_REGEX = "مشاوره";
export const VISIT_SERVICE_REGEX = "ویزیت";
export const ENTRY_SERVICE_REGEX = "مشاوره|ویزیت";

/** The three-way classification the doctor report groups its line counts by. */
export const REPORT_SERVICE_KINDS = ["consultation", "visit", "service"] as const;
export type ReportServiceKind = (typeof REPORT_SERVICE_KINDS)[number];

export const REPORT_SERVICE_KIND_LABELS: Record<ReportServiceKind, string> = {
  consultation: "مشاوره",
  visit: "ویزیت",
  service: "خدمت",
};

export const doctorSchema = z.object({
  name: z.string(),
  lineCount: z.number(),
  patientCount: z.number(),
  received: z.number(),
});
export type Doctor = z.infer<typeof doctorSchema>;

// ─── Doctor performance report ───

export const doctorReportRowSchema = z.object({
  doctorName: z.string(),
  /** Distinct receptions the doctor appears on, not billed lines. */
  receptionCount: z.number(),
  lineCount: z.number(),
  patientCount: z.number(),
  /** Patients whose first-ever line with this doctor falls inside the range. */
  newPatientCount: z.number(),
  received: z.number(),
  discount: z.number(),
  outstanding: z.number(),
  averagePerPatient: z.number(),
  averagePerReception: z.number(),
  /** Lines named مشاوره. */
  consultationCount: z.number(),
  /** Lines named ویزیت — an entry point too, counted apart from مشاوره. */
  visitCount: z.number(),
  /** Lines that are neither: the billable work, called خدمت on the report. */
  serviceCount: z.number(),
  /** Share of clinic revenue in the range. */
  revenueShare: z.number(),
});
export type DoctorReportRow = z.infer<typeof doctorReportRowSchema>;

export const doctorReportSortKeySchema = z.enum([
  "received",
  "patients",
  "receptions",
  "lines",
  "discount",
  "outstanding",
  "avgPerPatient",
  "newPatients",
  "name",
]);
export type DoctorReportSortKey = z.infer<typeof doctorReportSortKeySchema>;

export const doctorReportQuerySchema = financialRangeSchema.extend({
  /** Repeatable/comma-joined; empty means every doctor. */
  doctors: z.preprocess(
    (v) => (v === undefined || v === "" ? undefined : Array.isArray(v) ? v : String(v).split(",")),
    z.array(z.string().trim().min(1)).optional(),
  ),
  tier: patientTierSchema.optional(),
  /**
   * Narrow the report to one class of line. `treatment` is the name the
   * three-way split replaced; it is still accepted so a bookmarked filter or a
   * saved link keeps working instead of 400-ing.
   */
  serviceKind: z.preprocess(
    (v) => (v === "treatment" ? "service" : v),
    z.enum(["all", ...REPORT_SERVICE_KINDS]).default("all"),
  ),
  sort: doctorReportSortKeySchema.default("received"),
  direction: z.enum(["asc", "desc"]).default("desc"),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
export type DoctorReportQuery = z.infer<typeof doctorReportQuerySchema>;

/** Per-period breakdown for a single doctor, used by the trend chart. */
export const doctorTrendPointSchema = z.object({
  period: z.string(),
  received: z.number(),
  patientCount: z.number(),
  receptionCount: z.number(),
});
export type DoctorTrendPoint = z.infer<typeof doctorTrendPointSchema>;

/**
 * Conversion for one entry service.
 *
 * A patient counts as converted when they received a خدمت on or after the day
 * of that entry line — same day included, because at this clinic the ویزیت and
 * the procedure routinely share a single reception. The denominator is patients
 * seen under that entry service inside the range, so a patient seen twice is
 * one, and a patient seen under both مشاوره and ویزیت is counted in each row.
 */
export const entryConversionRowSchema = z.object({
  entryName: z.string(),
  kind: z.enum(["consultation", "visit"]),
  patientCount: z.number(),
  convertedCount: z.number(),
  conversionRate: z.number(),
  /** What the converted patients then spent on خدمت. */
  serviceRevenue: z.number(),
});
export type EntryConversionRow = z.infer<typeof entryConversionRowSchema>;

export const doctorReportSchema = z.object({
  rows: z.array(doctorReportRowSchema),
  totals: z.object({
    doctorCount: z.number(),
    received: z.number(),
    discount: z.number(),
    outstanding: z.number(),
    patientCount: z.number(),
    receptionCount: z.number(),
    lineCount: z.number(),
  }),
  /**
   * Share of lines in the range naming two practitioners, and therefore counted
   * once per doctor. Disclosed so a reader can tell why the column does not sum
   * to clinic revenue.
   */
  sharedLineCount: z.number(),
  /**
   * «چند درصد از مشاوره‌ها و ویزیت‌ها خدمت شد» — one row per entry service, so
   * مشاوره زیبایی and ویزیت مجدد are answered separately rather than averaged
   * into a single number that describes neither.
   */
  entryConversion: z.array(entryConversionRowSchema),
  generatedAt: z.string(),
});
export type DoctorReport = z.infer<typeof doctorReportSchema>;

// ─── Referral report: consulted by one doctor, treated by another ───

/**
 * "Consulted with X, treated by someone else."
 *
 * A patient qualifies when they have at least one *consultation* line naming
 * the source doctor, and at least one *treatment* line — on or after the day of
 * that consultation — naming a different practitioner.
 *
 * The date ordering matters. Without it, a patient who was treated by another
 * doctor years earlier and only later consulted the source doctor would count
 * as a referral, which reverses the direction the report is meant to measure.
 */
export const referralPatientSchema = z.object({
  patientId: z.string().nullable(),
  patientExternalCode: z.number(),
  fullName: z.string().nullable(),
  mobile: z.string().nullable(),
  tier: patientTierSchema.nullable(),
  tierLabel: z.string().nullable(),
  /** Jalali date of the first qualifying consultation. */
  consultationDate: z.string().nullable(),
  consultationCount: z.number(),
  /** Practitioners who delivered the follow-on treatment. */
  treatingDoctors: z.array(z.string()),
  /**
   * The services that treatment consisted of.
   *
   * "Referred to whom" on its own does not tell the clinic whether the handover
   * was the procedure the consultation was about; the service names are what
   * make the row readable as a clinical outcome rather than a revenue line.
   * Capped in SQL — a long-standing patient can have dozens.
   */
  treatmentServices: z.array(z.string()),
  treatmentCount: z.number(),
  /** Revenue from the follow-on treatment lines only. */
  treatmentReceived: z.number(),
  /** Revenue booked by the consulting doctor for the same patient. */
  consultingDoctorReceived: z.number(),
  firstTreatmentDate: z.string().nullable(),
  lastTreatmentDate: z.string().nullable(),
  lifetimeSpend: z.number(),
});
export type ReferralPatient = z.infer<typeof referralPatientSchema>;

export const referralSortKeySchema = z.enum([
  "treatmentReceived",
  "lifetimeSpend",
  "treatmentCount",
  "consultationDate",
  "firstTreatmentDate",
  "name",
]);
export type ReferralSortKey = z.infer<typeof referralSortKeySchema>;

export const referralQuerySchema = financialRangeSchema.extend({
  /**
   * The consulting doctor. Defaults to Dr. Nilforoushzadeh, who accounts for
   * the large majority of consultations, but any practitioner can be named.
   */
  consultingDoctor: z.string().trim().min(1).default("محمد علی نیلفروش زاده"),
  /** Restrict the follow-on treatment to these practitioners. */
  treatingDoctors: z.preprocess(
    (v) => (v === undefined || v === "" ? undefined : Array.isArray(v) ? v : String(v).split(",")),
    z.array(z.string().trim().min(1)).optional(),
  ),
  tier: patientTierSchema.optional(),
  sort: referralSortKeySchema.default("treatmentReceived"),
  direction: z.enum(["asc", "desc"]).default("desc"),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  search: z.string().trim().min(1).optional(),
});
export type ReferralQuery = z.infer<typeof referralQuerySchema>;

export const referralReportSchema = z.object({
  patients: z.array(referralPatientSchema),
  total: z.number(),
  summary: z.object({
    consultingDoctor: z.string(),
    /** Everyone the source doctor consulted in the range. */
    totalConsulted: z.number(),
    /** Of those, how many went on to be treated by someone else. */
    referredOut: z.number(),
    /** Of those, how many the source doctor also treated personally. */
    retained: z.number(),
    referralRate: z.number(),
    treatmentRevenue: z.number(),
    /** Mean follow-on treatment revenue per referred patient. */
    averagePerReferral: z.number(),
  }),
  /** Where the referred-out revenue landed. */
  byTreatingDoctor: z.array(
    z.object({
      doctorName: z.string(),
      patientCount: z.number(),
      treatmentCount: z.number(),
      received: z.number(),
    }),
  ),
  generatedAt: z.string(),
});
export type ReferralReport = z.infer<typeof referralReportSchema>;
