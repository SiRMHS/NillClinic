import {
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
  message: string;
}

interface MappedPatient {
  externalCode: number;
  plaintext: JordanPatient;
}

export interface MappedService {
  externalId: number;
  data: JordanService;
}

export interface MappedReserve {
  data: JordanReserve;
}

export interface MappedTreatment {
  externalId: string;
  data: JordanTreatment;
  reasonNames: string[];
}

export interface MappedReception {
  externalId: number;
  data: JordanReception;
  treatmentItemNamesList: string[];
}

function normalizeService(data: JordanService): JordanService {
  return {
    ...data,
    srvName: normalizeCrmText(data.srvName),
    secName: normalizeCrmText(data.secName),
  };
}

function normalizeTreatment(data: JordanTreatment): { data: JordanTreatment; reasonNames: string[] } {
  const reasonNames = splitCrmLabels(data.treatmentPlanReasonName);
  const details = data.treatmentPlanDetails.map((d) => ({
    ...d,
    treatmentPlanDetailName: d.treatmentPlanDetailName
      ? normalizeCrmText(d.treatmentPlanDetailName)
      : d.treatmentPlanDetailName,
    treatmentItems: normalizeCrmText(d.treatmentItems),
  }));

  return {
    reasonNames,
    data: {
      ...data,
      treatmentPlanName: normalizeCrmText(data.treatmentPlanName),
      treatmentPlanUser: normalizeCrmText(data.treatmentPlanUser),
      treatmentPlanReasonName: primaryCrmLabel(data.treatmentPlanReasonName),
      treatmentPlanDetails: details,
    },
  };
}

function normalizeReception(data: JordanReception): { data: JordanReception; treatmentItemNamesList: string[] } {
  const treatmentItemNamesList = splitCrmLabels(data.treatmentItemNames);
  const details = data.receptionDetailDtos.map((d) => ({
    ...d,
    secName: normalizeCrmText(d.secName),
    srvName: normalizeCrmText(d.srvName),
    receptionPersonnelName: d.receptionPersonnelName
      ? joinCrmLabels(splitCrmLabels(d.receptionPersonnelName))
      : d.receptionPersonnelName,
  }));

  return {
    treatmentItemNamesList,
    data: {
      ...data,
      userName: normalizeCrmText(data.userName),
      receptionDescription: data.receptionDescription
        ? normalizeCrmText(data.receptionDescription)
        : data.receptionDescription,
      treatmentItemNames: treatmentItemNamesList.length
        ? joinCrmLabels(treatmentItemNamesList)
        : normalizeCrmText(data.treatmentItemNames),
      receptionDetailDtos: details,
    },
  };
}

/**
 * Validates and maps raw CRM JSON to internal DTOs before upsert.
 */
export class MappingEngine {
  mapPatients(raw: unknown[]): { valid: MappedPatient[]; invalid: MappedInvalid[] } {
    const valid: MappedPatient[] = [];
    const invalid: MappedInvalid[] = [];

    for (const item of raw) {
      const parsed = jordanPatientSchema.safeParse(item);
      if (!parsed.success) {
        const body = item && typeof item === "object" ? JSON.stringify(item).slice(0, 300) : String(item);
        invalid.push({ message: `${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")} | body: ${body}` });
        continue;
      }
      valid.push({ externalCode: parsed.data.patientCode, plaintext: parsed.data });
    }

    return { valid, invalid };
  }

  mapServices(raw: unknown[]): { valid: MappedService[]; invalid: MappedInvalid[] } {
    const valid: MappedService[] = [];
    const invalid: MappedInvalid[] = [];

    for (const item of raw) {
      const parsed = jordanServiceSchema.safeParse(item);
      if (!parsed.success) {
        const body = item && typeof item === "object" ? JSON.stringify(item).slice(0, 300) : String(item);
        invalid.push({ message: `${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")} | body: ${body}` });
        continue;
      }
      const data = normalizeService(parsed.data);
      valid.push({ externalId: data.srvId, data });
    }

    return { valid, invalid };
  }

  mapReserves(raw: unknown[]): { valid: MappedReserve[]; invalid: MappedInvalid[] } {
    const valid: MappedReserve[] = [];
    const invalid: MappedInvalid[] = [];

    for (const item of raw) {
      const parsed = jordanReserveSchema.safeParse(item);
      if (!parsed.success) {
        const body = item && typeof item === "object" ? JSON.stringify(item).slice(0, 300) : String(item);
        invalid.push({ message: `${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")} | body: ${body}` });
        continue;
      }
      valid.push({
        data: {
          ...parsed.data,
          doctorName: normalizeCrmText(parsed.data.doctorName),
        },
      });
    }

    return { valid, invalid };
  }

  mapTreatments(raw: unknown[]): { valid: MappedTreatment[]; invalid: MappedInvalid[] } {
    const valid: MappedTreatment[] = [];
    const invalid: MappedInvalid[] = [];

    for (const item of raw) {
      const parsed = jordanTreatmentSchema.safeParse(item);
      if (!parsed.success) {
        const body = item && typeof item === "object" ? JSON.stringify(item).slice(0, 300) : String(item);
        invalid.push({ message: `${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")} | body: ${body}` });
        continue;
      }
      const { data, reasonNames } = normalizeTreatment(parsed.data);
      valid.push({ externalId: data.treatmentPlanId, data, reasonNames });
    }

    return { valid, invalid };
  }

  mapReceptions(raw: unknown[]): { valid: MappedReception[]; invalid: MappedInvalid[] } {
    const valid: MappedReception[] = [];
    const invalid: MappedInvalid[] = [];

    for (const item of raw) {
      const parsed = jordanReceptionSchema.safeParse(item);
      if (!parsed.success) {
        const body = item && typeof item === "object" ? JSON.stringify(item).slice(0, 300) : String(item);
        invalid.push({ message: `${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")} | body: ${body}` });
        continue;
      }
      const { data, treatmentItemNamesList } = normalizeReception(parsed.data);
      valid.push({ externalId: data.receptionId, data, treatmentItemNamesList });
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
