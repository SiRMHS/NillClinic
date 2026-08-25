import { z } from "zod";

/**
 * Schemas aligned with secapidocs.md — Jordan CRM API responses.
 *
 * Design rule: the CRM emits `null`, `""` or `" "` interchangeably for "no value",
 * on fields its own Swagger declares as non-nullable. A record must therefore never
 * be discarded over a missing *attribute* — only over a missing *identity* field
 * (the key we upsert on). Everything else degrades to null/0/"" instead of failing.
 *
 * The previous strict schemas dropped whole records on `gender: null` and
 * `doctorName: null`, and silently stripped the financial fields because zod
 * removes unknown keys by default.
 */

/** Text that may be absent. Blank/whitespace-only collapses to null. */
const nullableText = z
  .union([z.string(), z.number(), z.boolean()])
  .nullish()
  .transform((v) => {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    return s.length > 0 ? s : null;
  });

/** Text we always want a string for downstream (never null). */
const text = nullableText.transform((v) => v ?? "");

/** Number that may be absent, or arrive as a numeric string. */
const nullableNumber = z
  .union([z.number(), z.string()])
  .nullish()
  .transform((v) => {
    if (v === null || v === undefined) return null;
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    const trimmed = v.trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  });

/** Identity field — the only kind of failure that may reject a record. */
const requiredNumber = nullableNumber.pipe(z.number());

/** Monetary value; absent means zero, never null (keeps SUM() honest). */
const money = nullableNumber.transform((v) => v ?? 0);

/** CRM sends booleans as true/false, 0/1, or "true"/"1". */
const bool = z
  .union([z.boolean(), z.number(), z.string()])
  .nullish()
  .transform((v) => v === true || v === 1 || v === "1" || v === "true");

/** Tri-state flag where "unknown" is meaningful (e.g. isResident). */
const nullableBool = z
  .union([z.boolean(), z.number(), z.string()])
  .nullish()
  .transform((v) => {
    if (v === null || v === undefined || v === "") return null;
    return v === true || v === 1 || v === "1" || v === "true";
  });

// ─── Services ───

export const jordanServiceSchema = z.object({
  srvId: requiredNumber,
  srvName: text,
  secName: text,
  sectionId: nullableNumber,
  tarriff: money,
});

// ─── Patients ───

export const jordanPatientSchema = z.object({
  fullName: text,
  mobile: nullableText,
  patientCode: requiredNumber,
  tel: nullableText,
  /** Null in the wild despite Swagger typing it non-null. → GenderType.id */
  gender: nullableNumber,
  address: nullableText,
  degree: nullableText,
  fatherName: nullableText,
  /** Jalali `YYYY/MM/DD`; often `" "` for unknown. */
  birthDate: nullableText,
  residentCountry: nullableText,
  /** → IntroductionType.id */
  introduction: nullableNumber,
  job: nullableText,
  isResident: nullableBool,
});

// ─── Reserves ───

/**
 * Note: the CRM exposes no reserve id, and (reserveDate, reserveTime, doctorName)
 * is NOT unique — a 1000-record sample held 836 distinct triples, i.e. 164 records
 * overwrote each other. Three different patients routinely share one doctor/time
 * slot. The sync engine derives a stable synthetic key from the full identity
 * tuple instead; see `reserveExternalKey` in sync-engine/src/mapping.engine.ts.
 */
export const jordanReserveSchema = z.object({
  reserveDate: nullableText,
  reserveTime: nullableText,
  /** Comma-separated service names, e.g. "ویزیت مجدد,". */
  services: nullableText,
  createDate: nullableText,
  createTime: nullableText,
  isAccepted: bool,
  /** Null in the wild — previously dropped the whole record. */
  doctorName: nullableText,
  /** Present in the live payload but absent from the old schema, so it was stripped. */
  patientName: nullableText,
  patientCode: nullableNumber,
  patientMobile: nullableText,
});

// ─── Treatments ───

export const treatmentPlanDetailSchema = z.object({
  treatmentPlanDetailsId: nullableText,
  treatmentPlanDetailName: nullableText,
  treatmentItems: text,
  treatmentItemSrvId: nullableNumber,
  isDeleted: bool,
});

export const jordanTreatmentSchema = z.object({
  treatmentPlanId: z.string().min(1),
  treatmentPlanDate: nullableText,
  treatmentPlanName: nullableText,
  patientCode: nullableNumber,
  treatmentPlanUser: nullableText,
  treatmentPlanReasonName: nullableText,
  treatmentPlanDetails: z.array(treatmentPlanDetailSchema).nullish().transform((v) => v ?? []),
  treatmentPlanDeleted: bool,
});

// ─── Receptions ───

/**
 * The four monetary fields below are returned by the live API but were missing
 * from this schema, so zod's default key-stripping silently discarded every
 * price before it reached the database. They are the basis of all financial
 * reporting.
 */
export const jordanReceptionDetailSchema = z.object({
  secId: nullableNumber,
  srvId: nullableNumber,
  secName: text,
  srvName: text,
  receptionPersonnelName: nullableText,
  receivedPrice: money,
  remainPrice: money,
  discount: money,
  depositPrice: money,
});

export const jordanReceptionSchema = z.object({
  receptionId: requiredNumber,
  receptionNo: nullableNumber,
  receptionDate: nullableText,
  patientNo: nullableNumber,
  isReturn: bool,
  receptionDescription: nullableText,
  treatmentItemNames: nullableText,
  userName: nullableText,
  receptionDetailDtos: z
    .array(jordanReceptionDetailSchema)
    .nullish()
    .transform((v) => v ?? []),
});

export type JordanService = z.infer<typeof jordanServiceSchema>;
export type JordanPatient = z.infer<typeof jordanPatientSchema>;
export type JordanReserve = z.infer<typeof jordanReserveSchema>;
export type JordanTreatment = z.infer<typeof jordanTreatmentSchema>;
export type JordanTreatmentDetail = z.infer<typeof treatmentPlanDetailSchema>;
export type JordanReception = z.infer<typeof jordanReceptionSchema>;
export type JordanReceptionDetail = z.infer<typeof jordanReceptionDetailSchema>;
