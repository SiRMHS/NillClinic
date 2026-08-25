import { createHash } from "node:crypto";
import {
  jalaliToSqlDate,
  jordanPatientSchema,
  jordanReceptionSchema,
  jordanReserveSchema,
  jordanServiceSchema,
  jordanTreatmentSchema,
  joinCrmLabels,
  normalizeCrmText,
  primaryCrmLabel,
  splitCrmLabels,
  type JordanPatient,
  type JordanReception,
  type JordanReserve,
  type JordanService,
  type JordanTreatment,
} from "@jordan/shared";
import type { SyncEntity } from "@jordan/db";

export interface MappedInvalid {
  /** Identity of the offending record when we could recover one. */
  recordId: string;
  message: string;
}

export interface MappedResult<T> {
  valid: T[];
  invalid: MappedInvalid[];
}

/** Null-safe text normalizer: blank stays null instead of becoming "". */
function normOrNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const n = normalizeCrmText(value);
  return n.length ? n : null;
}

/**
 * Stable synthetic identity for a reserve.
 *
 * The CRM exposes no reserve id, and (reserveDate, reserveTime, doctorName) is
 * not unique: in a 1000-record sample it yielded only 836 distinct triples,
 * silently destroying 164 records — three different patients regularly share a
 * single doctor/time slot. Nulls are folded to "" so the hash stays
 * deterministic; a SQL UNIQUE over nullable columns would not dedupe NULLs at
 * all, letting duplicates accumulate on every re-sync.
 */
export function reserveExternalKey(input: {
  reserveDate: string | null;
  reserveTime: string | null;
  doctorName: string | null;
  patientCode: number | null;
  patientName: string | null;
  patientMobile: string | null;
}): string {
  const tuple = [
    input.reserveDate ?? "",
    input.reserveTime ?? "",
    input.doctorName ?? "",
    input.patientCode ?? "",
    input.patientName ?? "",
    input.patientMobile ?? "",
  ].join("|");
  return createHash("sha256").update(tuple).digest("hex").slice(0, 32);
}

export interface MappedPatient {
  externalCode: number;
  plaintext: JordanPatient;
}

export interface MappedService {
  externalId: number;
  data: JordanService;
}

export interface MappedReserve {
  externalKey: string;
  data: JordanReserve;
  servicesList: string[];
}

export interface MappedTreatment {
  externalId: string;
  data: JordanTreatment;
  reasonNames: string[];
}

export interface MappedReceptionItem {
  lineNo: number;
  sectionId: number | null;
  serviceExternalId: number | null;
  sectionName: string | null;
  serviceName: string | null;
  personnelName: string | null;
  receivedPrice: number;
  remainPrice: number;
  discount: number;
  depositPrice: number;
}

export interface MappedReception {
  externalId: number;
  data: JordanReception;
  treatmentItemNamesList: string[];
  /** `YYYY-MM-DD` for a timezone-free `::timestamp` write. */
  receptionAtSql: string | null;
  items: MappedReceptionItem[];
  totals: {
    totalReceived: number;
    totalDiscount: number;
    totalRemain: number;
    totalDeposit: number;
    itemCount: number;
  };
}

function describeIssues(error: { issues: { path: (string | number)[]; message: string }[] }): string {
  return error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
}

function bodyPreview(item: unknown): string {
  return item && typeof item === "object" ? JSON.stringify(item).slice(0, 300) : String(item);
}

/**
 * Validates and maps raw CRM JSON to internal DTOs before upsert.
 *
 * Records are only rejected when their identity field is unusable; every other
 * CRM quirk (nulls in non-nullable fields, blank dates, missing prices) is
 * absorbed by the schemas rather than costing us the record.
 */
export class MappingEngine {
  mapPatients(raw: unknown[]): MappedResult<MappedPatient> {
    const valid: MappedPatient[] = [];
    const invalid: MappedInvalid[] = [];

    for (const item of raw) {
      const parsed = jordanPatientSchema.safeParse(item);
      if (!parsed.success) {
        invalid.push({
          recordId: String((item as { patientCode?: unknown })?.patientCode ?? "?"),
          message: `${describeIssues(parsed.error)} | body: ${bodyPreview(item)}`,
        });
        continue;
      }
      const d = parsed.data;
      valid.push({
        externalCode: d.patientCode,
        plaintext: {
          ...d,
          fullName: normalizeCrmText(d.fullName),
          job: normOrNull(d.job),
          degree: normOrNull(d.degree),
          address: normOrNull(d.address),
          fatherName: normOrNull(d.fatherName),
          residentCountry: normOrNull(d.residentCountry),
        },
      });
    }

    return { valid, invalid };
  }

  mapServices(raw: unknown[]): MappedResult<MappedService> {
    const valid: MappedService[] = [];
    const invalid: MappedInvalid[] = [];

    for (const item of raw) {
      const parsed = jordanServiceSchema.safeParse(item);
      if (!parsed.success) {
        invalid.push({
          recordId: String((item as { srvId?: unknown })?.srvId ?? "?"),
          message: `${describeIssues(parsed.error)} | body: ${bodyPreview(item)}`,
        });
        continue;
      }
      const data = {
        ...parsed.data,
        srvName: normalizeCrmText(parsed.data.srvName),
        secName: normalizeCrmText(parsed.data.secName),
      };
      valid.push({ externalId: data.srvId, data });
    }

    return { valid, invalid };
  }

  mapReserves(raw: unknown[]): MappedResult<MappedReserve> {
    const valid: MappedReserve[] = [];
    const invalid: MappedInvalid[] = [];
    // Deduplicate inside the batch too: the CRM can repeat a reserve across
    // overlapping pages, and a duplicate key inside one createMany would abort
    // the whole chunk.
    const seen = new Set<string>();

    for (const item of raw) {
      const parsed = jordanReserveSchema.safeParse(item);
      if (!parsed.success) {
        invalid.push({
          recordId: String((item as { reserveDate?: unknown })?.reserveDate ?? "?"),
          message: `${describeIssues(parsed.error)} | body: ${bodyPreview(item)}`,
        });
        continue;
      }

      const d = parsed.data;
      const data: JordanReserve = {
        ...d,
        doctorName: normOrNull(d.doctorName),
        patientName: normOrNull(d.patientName),
      };
      const externalKey = reserveExternalKey({
        reserveDate: data.reserveDate,
        reserveTime: data.reserveTime,
        doctorName: data.doctorName,
        patientCode: data.patientCode,
        patientName: data.patientName,
        patientMobile: data.patientMobile,
      });
      if (seen.has(externalKey)) continue;
      seen.add(externalKey);

      valid.push({ externalKey, data, servicesList: splitCrmLabels(d.services) });
    }

    return { valid, invalid };
  }

  mapTreatments(raw: unknown[]): MappedResult<MappedTreatment> {
    const valid: MappedTreatment[] = [];
    const invalid: MappedInvalid[] = [];
    const seen = new Set<string>();

    for (const item of raw) {
      const parsed = jordanTreatmentSchema.safeParse(item);
      if (!parsed.success) {
        invalid.push({
          recordId: String((item as { treatmentPlanId?: unknown })?.treatmentPlanId ?? "?"),
          message: `${describeIssues(parsed.error)} | body: ${bodyPreview(item)}`,
        });
        continue;
      }

      const d = parsed.data;
      if (seen.has(d.treatmentPlanId)) continue;
      seen.add(d.treatmentPlanId);

      const reasonNames = splitCrmLabels(d.treatmentPlanReasonName);
      const data: JordanTreatment = {
        ...d,
        treatmentPlanName: normOrNull(d.treatmentPlanName),
        treatmentPlanUser: normOrNull(d.treatmentPlanUser),
        treatmentPlanReasonName: d.treatmentPlanReasonName
          ? primaryCrmLabel(d.treatmentPlanReasonName)
          : null,
        treatmentPlanDetails: d.treatmentPlanDetails.map((detail) => ({
          ...detail,
          treatmentPlanDetailName: normOrNull(detail.treatmentPlanDetailName),
          treatmentItems: normalizeCrmText(detail.treatmentItems),
        })),
      };

      valid.push({ externalId: d.treatmentPlanId, data, reasonNames });
    }

    return { valid, invalid };
  }

  mapReceptions(raw: unknown[]): MappedResult<MappedReception> {
    const valid: MappedReception[] = [];
    const invalid: MappedInvalid[] = [];
    const seen = new Set<number>();

    for (const item of raw) {
      const parsed = jordanReceptionSchema.safeParse(item);
      if (!parsed.success) {
        invalid.push({
          recordId: String((item as { receptionId?: unknown })?.receptionId ?? "?"),
          message: `${describeIssues(parsed.error)} | body: ${bodyPreview(item)}`,
        });
        continue;
      }

      const d = parsed.data;
      if (seen.has(d.receptionId)) continue;
      seen.add(d.receptionId);

      const treatmentItemNamesList = splitCrmLabels(d.treatmentItemNames);
      const items: MappedReceptionItem[] = d.receptionDetailDtos.map((detail, index) => ({
        lineNo: index,
        sectionId: detail.secId,
        serviceExternalId: detail.srvId,
        sectionName: normOrNull(detail.secName),
        serviceName: normOrNull(detail.srvName),
        personnelName: detail.receptionPersonnelName
          ? joinCrmLabels(splitCrmLabels(detail.receptionPersonnelName))
          : null,
        receivedPrice: detail.receivedPrice,
        remainPrice: detail.remainPrice,
        discount: detail.discount,
        depositPrice: detail.depositPrice,
      }));

      const totals = items.reduce(
        (acc, line) => ({
          totalReceived: acc.totalReceived + line.receivedPrice,
          totalDiscount: acc.totalDiscount + line.discount,
          totalRemain: acc.totalRemain + line.remainPrice,
          totalDeposit: acc.totalDeposit + line.depositPrice,
          itemCount: acc.itemCount + 1,
        }),
        { totalReceived: 0, totalDiscount: 0, totalRemain: 0, totalDeposit: 0, itemCount: 0 },
      );

      const data: JordanReception = {
        ...d,
        userName: normOrNull(d.userName),
        receptionDescription: normOrNull(d.receptionDescription),
        treatmentItemNames: treatmentItemNamesList.length
          ? joinCrmLabels(treatmentItemNamesList)
          : normOrNull(d.treatmentItemNames),
        receptionDetailDtos: d.receptionDetailDtos,
      };

      valid.push({
        externalId: d.receptionId,
        data,
        treatmentItemNamesList,
        receptionAtSql: jalaliToSqlDate(d.receptionDate),
        items,
        totals,
      });
    }

    return { valid, invalid };
  }

  entityForPath(path: string): SyncEntity | null {
    if (path.includes("Patient")) return "PATIENTS";
    if (path.includes("GetServices")) return "SERVICES";
    if (path.includes("Reserve")) return "RESERVES";
    if (path.includes("Treatment")) return "TREATMENTS";
    if (path.includes("Reception")) return "RECEPTIONS";
    return null;
  }
}
