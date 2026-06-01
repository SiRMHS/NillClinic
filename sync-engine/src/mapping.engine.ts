import {
  jordanPatientSchema,
  jordanReserveSchema,
  jordanServiceSchema,
  jordanTreatmentSchema,
  type JordanPatient,
  type JordanReserve,
  type JordanService,
  type JordanTreatment,
} from "@jordan/shared";
import type { SyncEntity } from "@jordan/db";

export interface MappedPatient {
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
}

/**
 * Validates and maps raw CRM JSON to internal DTOs before upsert.
 */
export class MappingEngine {
  mapPatients(raw: unknown[]): { valid: MappedPatient[]; invalid: number } {
    const valid: MappedPatient[] = [];
    let invalid = 0;

    for (const item of raw) {
      const parsed = jordanPatientSchema.safeParse(item);
      if (!parsed.success) {
        invalid++;
        continue;
      }
      valid.push({ externalCode: parsed.data.patientCode, plaintext: parsed.data });
    }

    return { valid, invalid };
  }

  mapServices(raw: unknown[]): { valid: MappedService[]; invalid: number } {
    const valid: MappedService[] = [];
    let invalid = 0;

    for (const item of raw) {
      const parsed = jordanServiceSchema.safeParse(item);
      if (!parsed.success) {
        invalid++;
        continue;
      }
      valid.push({ externalId: parsed.data.srvId, data: parsed.data });
    }

    return { valid, invalid };
  }

  mapReserves(raw: unknown[]): { valid: MappedReserve[]; invalid: number } {
    const valid: MappedReserve[] = [];
    let invalid = 0;

    for (const item of raw) {
      const parsed = jordanReserveSchema.safeParse(item);
      if (!parsed.success) {
        invalid++;
        continue;
      }
      valid.push({ data: parsed.data });
    }

    return { valid, invalid };
  }

  mapTreatments(raw: unknown[]): { valid: MappedTreatment[]; invalid: number } {
    const valid: MappedTreatment[] = [];
    let invalid = 0;

    for (const item of raw) {
      const parsed = jordanTreatmentSchema.safeParse(item);
      if (!parsed.success) {
        invalid++;
        continue;
      }
      valid.push({ externalId: parsed.data.treatmentPlanId, data: parsed.data });
    }

    return { valid, invalid };
  }

  entityForPath(path: string): SyncEntity | null {
    if (path.includes("Patient")) return "PATIENTS";
    if (path.includes("GetServices")) return "SERVICES";
    if (path.includes("Reserve")) return "RESERVES";
    if (path.includes("Treatment")) return "TREATMENTS";
    return null;
  }
}
