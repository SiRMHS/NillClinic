import { z } from "zod";

/** Schemas aligned with secapidocs.md — Jordan CRM API responses */

export const jordanServiceSchema = z.object({
  srvId: z.number(),
  srvName: z.string(),
  secName: z.string(),
  sectionId: z.number(),
  tarriff: z.number(),
});

export const jordanPatientSchema = z.object({
  fullName: z.string(),
  mobile: z.string(),
  patientCode: z.number(),
  tel: z.string(),
  gender: z.number(),
  address: z.string(),
  degree: z.string().nullable(),
  fatherName: z.string(),
  birthDate: z.string(),
  residentCountry: z.string().nullable(),
  introduction: z.number().nullable(),
  job: z.string(),
  isResident: z.boolean().nullable(),
});

export const jordanReserveSchema = z.object({
  reserveDate: z.string(),
  reserveTime: z.string(),
  services: z.unknown().nullable(),
  createDate: z.string().nullable(),
  createTime: z.string().nullable(),
  isAccepted: z.boolean(),
  doctorName: z.string(),
});

export const treatmentPlanDetailSchema = z.object({
  treatmentPlanDetailsId: z.string(),
  treatmentPlanDetailName: z.string().nullable(),
  treatmentItems: z.string(),
  treatmentItemSrvId: z.unknown().nullable(),
  isDeleted: z.boolean(),
});

export const jordanTreatmentSchema = z.object({
  treatmentPlanId: z.string(),
  treatmentPlanDate: z.string(),
  treatmentPlanName: z.string(),
  patientCode: z.number(),
  treatmentPlanUser: z.string(),
  treatmentPlanReasonName: z.string(),
  treatmentPlanDetails: z.array(treatmentPlanDetailSchema),
  treatmentPlanDeleted: z.boolean(),
});

export type JordanService = z.infer<typeof jordanServiceSchema>;
export type JordanPatient = z.infer<typeof jordanPatientSchema>;
export type JordanReserve = z.infer<typeof jordanReserveSchema>;
export type JordanTreatment = z.infer<typeof jordanTreatmentSchema>;
