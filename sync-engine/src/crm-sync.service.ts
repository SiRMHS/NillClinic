import { prisma, SyncEntity, SyncStatus, SyncTrigger, Prisma } from "@jordan/db";
import type { EncryptFn } from "./types.js";
import { ConflictResolver } from "./conflict.resolver.js";
import { JordanApiClient } from "./jordan-api.client.js";
import { MappingEngine } from "./mapping.engine.js";

export interface SyncErrorDetail {
  recordId: string;
  message: string;
}

export interface ProgressUpdate {
  recordsRead: number;
  recordsUpserted: number;
  recordsFailed: number;
  pagesProcessed: number;
  errors?: SyncErrorDetail[];
}

export interface SyncResult {
  entity: SyncEntity;
  status: SyncStatus;
  recordsRead: number;
  recordsUpserted: number;
  recordsFailed: number;
  errorMessage?: string;
  pagesProcessed: number;
  metadata?: Record<string, unknown>;
  errorDetails?: SyncErrorDetail[];
}

export interface SyncConfig {
  maxPages?: number;
  pageSize?: number;
  entities?: SyncEntity[];
  signal?: AbortSignal;
}

const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_MAX_PAGES = 2;

export class CrmSyncService {
  private readonly mapper = new MappingEngine();
  private readonly conflictResolver = new ConflictResolver("crm_wins");

  constructor(
    private readonly api: JordanApiClient,
    private readonly encrypt: EncryptFn,
  ) {}

  async syncAll(
    trigger: SyncTrigger = "CRON",
    config?: SyncConfig,
  ): Promise<SyncResult[]> {
    const entities = config?.entities ?? ["PATIENTS", "SERVICES", "RESERVES", "TREATMENTS", "RECEPTIONS"];
    const results: SyncResult[] = [];

    for (const entity of entities) {
      if (config?.signal?.aborted) break;
      let result: SyncResult;
      switch (entity) {
        case "PATIENTS":
          result = await this.syncPatients(trigger, config);
          break;
        case "SERVICES":
          result = await this.syncServices(trigger, config);
          break;
        case "RESERVES":
          result = await this.syncReserves(trigger, config);
          break;
        case "TREATMENTS":
          result = await this.syncTreatments(trigger, config);
          break;
        case "RECEPTIONS":
          result = await this.syncReceptions(trigger, config);
          break;
        default:
          continue;
      }
      results.push(result);
      if (config?.signal?.aborted) break;
    }

    return results;
  }

  async syncPatients(trigger: SyncTrigger, config?: SyncConfig): Promise<SyncResult> {
    return this.runSync("PATIENTS", trigger, async (onProgress, signal) => {
      const maxPages = config?.maxPages ?? DEFAULT_MAX_PAGES;
      const pageSize = config?.pageSize ?? DEFAULT_PAGE_SIZE;
      let totalRead = 0;
      let totalUpserted = 0;
      let totalFailed = 0;
      let pagesProcessed = 0;
      const allErrors: SyncErrorDetail[] = [];

      for (let page = 1; page <= maxPages; page++) {
        if (signal?.aborted) throw new Error("سینک توسط کاربر لغو شد");
        const raw = await this.api.getPatients({ page, pageSize });
        if (!raw.length) break;

        const { valid, invalid } = this.mapper.mapPatients(raw);
        totalRead += raw.length;
        totalFailed += invalid.length;
        for (const e of invalid) allErrors.push({ recordId: `صفحه ${page}`, message: e.message });

        for (const { externalCode, plaintext } of valid) {
          try {
            const syncedAt = new Date();
            await prisma.patient.upsert({
              where: { externalCode },
              create: {
                externalCode,
                fullNameEnc: this.encrypt(plaintext.fullName),
                fullName: plaintext.fullName,
                mobileEnc: plaintext.mobile ? this.encrypt(plaintext.mobile) : null,
                mobile: plaintext.mobile || null,
                telEnc: plaintext.tel ? this.encrypt(plaintext.tel) : null,
                addressEnc: plaintext.address ? this.encrypt(plaintext.address) : null,
                fatherNameEnc: plaintext.fatherName ? this.encrypt(plaintext.fatherName) : null,
                gender: plaintext.gender,
                degree: plaintext.degree ?? undefined,
                birthDate: plaintext.birthDate,
                residentCountry: plaintext.residentCountry ?? undefined,
                introduction: plaintext.introduction ?? undefined,
                job: plaintext.job,
                isResident: plaintext.isResident ?? undefined,
                syncedAt,
              },
              update: {
                fullNameEnc: this.encrypt(plaintext.fullName),
                fullName: plaintext.fullName,
                mobileEnc: plaintext.mobile ? this.encrypt(plaintext.mobile) : null,
                mobile: plaintext.mobile || null,
                telEnc: plaintext.tel ? this.encrypt(plaintext.tel) : null,
                addressEnc: plaintext.address ? this.encrypt(plaintext.address) : null,
                fatherNameEnc: plaintext.fatherName ? this.encrypt(plaintext.fatherName) : null,
                gender: plaintext.gender,
                degree: plaintext.degree ?? undefined,
                birthDate: plaintext.birthDate,
                job: plaintext.job,
                syncedAt,
              },
            });
            totalUpserted++;
          } catch (e) {
            allErrors.push({ recordId: String(externalCode), message: e instanceof Error ? e.message : "Unknown error" });
            totalFailed++;
          }
        }

        pagesProcessed = page;
        await onProgress({ recordsRead: totalRead, recordsUpserted: totalUpserted, recordsFailed: totalFailed, pagesProcessed, errors: allErrors });
      }

      return {
        recordsRead: totalRead,
        recordsUpserted: totalUpserted,
        recordsFailed: totalFailed,
        pagesProcessed,
        status:
          totalFailed > 0 && totalUpserted > 0
            ? "PARTIAL"
            : totalFailed > 0
              ? "FAILED"
              : "SUCCESS",
        errorDetails: allErrors,
      };
    }, config?.signal);
  }

  async syncServices(trigger: SyncTrigger, config?: SyncConfig): Promise<SyncResult> {
    return this.runSync("SERVICES", trigger, async (onProgress, signal) => {
      const maxPages = config?.maxPages ?? DEFAULT_MAX_PAGES;
      const pageSize = config?.pageSize ?? DEFAULT_PAGE_SIZE;
      let totalRead = 0;
      let totalUpserted = 0;
      let totalFailed = 0;
      let pagesProcessed = 0;
      const allErrors: SyncErrorDetail[] = [];

      for (let page = 1; page <= maxPages; page++) {
        if (signal?.aborted) throw new Error("سینک توسط کاربر لغو شد");
        const raw = await this.api.getServices({ page, pageSize });
        if (!raw.length) break;

        const { valid, invalid } = this.mapper.mapServices(raw);
        totalRead += raw.length;
        totalFailed += invalid.length;
        for (const e of invalid) allErrors.push({ recordId: `صفحه ${page}`, message: e.message });

        for (const { externalId, data } of valid) {
          try {
            await prisma.service.upsert({
              where: { externalId },
              create: {
                externalId,
                name: data.srvName,
                sectionName: data.secName,
                sectionId: data.sectionId,
                tariff: data.tarriff,
                syncedAt: new Date(),
              },
              update: {
                externalId,
                name: data.srvName,
                sectionName: data.secName,
                tariff: data.tarriff,
                syncedAt: new Date(),
              },
            });
            totalUpserted++;
          } catch (e) {
            allErrors.push({ recordId: String(externalId), message: e instanceof Error ? e.message : "Unknown error" });
            totalFailed++;
          }
        }

        pagesProcessed = page;
        await onProgress({ recordsRead: totalRead, recordsUpserted: totalUpserted, recordsFailed: totalFailed, pagesProcessed, errors: allErrors });
      }

      return {
        recordsRead: totalRead,
        recordsUpserted: totalUpserted,
        recordsFailed: totalFailed,
        pagesProcessed,
        status:
          totalFailed > 0 && totalUpserted > 0
            ? "PARTIAL"
            : totalFailed > 0
              ? "FAILED"
              : "SUCCESS",
        errorDetails: allErrors,
      };
    }, config?.signal);
  }

  async syncReserves(trigger: SyncTrigger, config?: SyncConfig): Promise<SyncResult> {
    return this.runSync("RESERVES", trigger, async (onProgress, signal) => {
      const maxPages = config?.maxPages ?? DEFAULT_MAX_PAGES;
      const pageSize = config?.pageSize ?? DEFAULT_PAGE_SIZE;
      let totalRead = 0;
      let totalUpserted = 0;
      let totalFailed = 0;
      let pagesProcessed = 0;
      const allErrors: SyncErrorDetail[] = [];

      for (let page = 1; page <= maxPages; page++) {
        if (signal?.aborted) throw new Error("سینک توسط کاربر لغو شد");
        const raw = await this.api.getReserves({ page, pageSize });
        if (!raw.length) break;

        const { valid, invalid } = this.mapper.mapReserves(raw);
        totalRead += raw.length;
        totalFailed += invalid.length;
        for (const e of invalid) allErrors.push({ recordId: `صفحه ${page}`, message: e.message });

        for (const { data } of valid) {
          try {
            await prisma.reserve.upsert({
              where: {
                reserveDate_reserveTime_doctorName: {
                  reserveDate: data.reserveDate,
                  reserveTime: data.reserveTime,
                  doctorName: data.doctorName,
                },
              },
              create: {
                reserveDate: data.reserveDate,
                reserveTime: data.reserveTime,
                servicesRaw: data.services ? JSON.stringify(data.services) : null,
                createDate: data.createDate ?? undefined,
                createTime: data.createTime ?? undefined,
                isAccepted: data.isAccepted,
                doctorName: data.doctorName,
                syncedAt: new Date(),
              },
              update: {
                servicesRaw: data.services ? JSON.stringify(data.services) : null,
                isAccepted: data.isAccepted,
                syncedAt: new Date(),
              },
            });
            totalUpserted++;
          } catch (e) {
            allErrors.push({ recordId: `${data.reserveDate} ${data.reserveTime} ${data.doctorName}`, message: e instanceof Error ? e.message : "Unknown error" });
            totalFailed++;
          }
        }

        pagesProcessed = page;
        await onProgress({ recordsRead: totalRead, recordsUpserted: totalUpserted, recordsFailed: totalFailed, pagesProcessed, errors: allErrors });
      }

      return {
        recordsRead: totalRead,
        recordsUpserted: totalUpserted,
        recordsFailed: totalFailed,
        pagesProcessed,
        status:
          totalFailed > 0 && totalUpserted > 0
            ? "PARTIAL"
            : totalFailed > 0
              ? "FAILED"
              : "SUCCESS",
        errorDetails: allErrors,
      };
    }, config?.signal);
  }

  async syncTreatments(trigger: SyncTrigger, config?: SyncConfig): Promise<SyncResult> {
    return this.runSync("TREATMENTS", trigger, async (onProgress, signal) => {
      const maxPages = config?.maxPages ?? DEFAULT_MAX_PAGES;
      const pageSize = config?.pageSize ?? DEFAULT_PAGE_SIZE;
      let totalRead = 0;
      let totalUpserted = 0;
      let totalFailed = 0;
      let pagesProcessed = 0;
      const allErrors: SyncErrorDetail[] = [];

      for (let page = 1; page <= maxPages; page++) {
        if (signal?.aborted) throw new Error("سینک توسط کاربر لغو شد");
        const raw = await this.api.getTreatments({ page, pageSize });
        if (!raw.length) break;

        const { valid, invalid } = this.mapper.mapTreatments(raw);
        totalRead += raw.length;
        totalFailed += invalid.length;
        for (const e of invalid) allErrors.push({ recordId: `صفحه ${page}`, message: e.message });

        for (const { externalId, data, reasonNames } of valid) {
          try {
            const patient = await prisma.patient.findUnique({
              where: { externalCode: data.patientCode },
            });

            await prisma.treatment.upsert({
              where: { externalId },
              create: {
                externalId,
                externalPatientCode: data.patientCode,
                patientId: patient?.id,
                planDate: data.treatmentPlanDate,
                planName: data.treatmentPlanName,
                planUser: data.treatmentPlanUser,
                reasonName: data.treatmentPlanReasonName,
                reasonNames,
                detailsJson: data.treatmentPlanDetails as object,
                isDeleted: data.treatmentPlanDeleted,
                syncedAt: new Date(),
              },
              update: {
                planDate: data.treatmentPlanDate,
                planName: data.treatmentPlanName,
                planUser: data.treatmentPlanUser,
                reasonName: data.treatmentPlanReasonName,
                reasonNames,
                detailsJson: data.treatmentPlanDetails as object,
                isDeleted: data.treatmentPlanDeleted,
                syncedAt: new Date(),
              },
            });
            totalUpserted++;
          } catch (e) {
            allErrors.push({ recordId: externalId, message: e instanceof Error ? e.message : "Unknown error" });
            totalFailed++;
          }
        }

        pagesProcessed = page;
        await onProgress({ recordsRead: totalRead, recordsUpserted: totalUpserted, recordsFailed: totalFailed, pagesProcessed, errors: allErrors });
      }

      return {
        recordsRead: totalRead,
        recordsUpserted: totalUpserted,
        recordsFailed: totalFailed,
        pagesProcessed,
        status:
          totalFailed > 0 && totalUpserted > 0
            ? "PARTIAL"
            : totalFailed > 0
              ? "FAILED"
              : "SUCCESS",
        errorDetails: allErrors,
      };
    }, config?.signal);
  }

  async syncReceptions(trigger: SyncTrigger, config?: SyncConfig): Promise<SyncResult> {
    return this.runSync("RECEPTIONS", trigger, async (onProgress, signal) => {
      const maxPages = config?.maxPages ?? DEFAULT_MAX_PAGES;
      const pageSize = config?.pageSize ?? DEFAULT_PAGE_SIZE;
      let totalRead = 0;
      let totalUpserted = 0;
      let totalFailed = 0;
      let pagesProcessed = 0;
      const allErrors: SyncErrorDetail[] = [];

      for (let page = 1; page <= maxPages; page++) {
        if (signal?.aborted) throw new Error("سینک توسط کاربر لغو شد");
        const raw = await this.api.getReceptions({ page, pageSize, fromDate: "1400/01/01" });
        if (!raw.length) break;

        const { valid, invalid } = this.mapper.mapReceptions(raw);
        totalRead += raw.length;
        totalFailed += invalid.length;
        for (const e of invalid) allErrors.push({ recordId: `صفحه ${page}`, message: e.message });

        for (const { externalId, data, treatmentItemNamesList } of valid) {
          try {
            const patient = await prisma.patient.findUnique({
              where: { externalCode: data.patientNo ?? undefined },
            });

            await prisma.reception.upsert({
              where: { externalId },
              create: {
                externalId,
                receptionNo: data.receptionNo,
                patientExternalCode: data.patientNo ?? undefined,
                patientId: patient?.id,
                receptionDate: data.receptionDate,
                isReturn: data.isReturn,
                description: data.receptionDescription ?? undefined,
                treatmentItemNames: data.treatmentItemNames ?? undefined,
                treatmentItemNamesList,
                userName: data.userName,
                detailsJson: data.receptionDetailDtos as object,
                syncedAt: new Date(),
              },
              update: {
                receptionNo: data.receptionNo,
                patientId: patient?.id,
                receptionDate: data.receptionDate,
                isReturn: data.isReturn,
                description: data.receptionDescription ?? undefined,
                treatmentItemNames: data.treatmentItemNames ?? undefined,
                treatmentItemNamesList,
                userName: data.userName,
                detailsJson: data.receptionDetailDtos as object,
                syncedAt: new Date(),
              },
            });
            totalUpserted++;
          } catch (e) {
            allErrors.push({ recordId: String(externalId), message: e instanceof Error ? e.message : "Unknown error" });
            totalFailed++;
          }
        }

        pagesProcessed = page;
        await onProgress({ recordsRead: totalRead, recordsUpserted: totalUpserted, recordsFailed: totalFailed, pagesProcessed, errors: allErrors });
      }

      return {
        recordsRead: totalRead,
        recordsUpserted: totalUpserted,
        recordsFailed: totalFailed,
        pagesProcessed,
        status:
          totalFailed > 0 && totalUpserted > 0
            ? "PARTIAL"
            : totalFailed > 0
              ? "FAILED"
              : "SUCCESS",
        errorDetails: allErrors,
      };
    }, config?.signal);
  }

  private async runSync(
    entity: SyncEntity,
    trigger: SyncTrigger,
    fn: (
      onProgress: (p: ProgressUpdate) => Promise<void>,
      signal?: AbortSignal,
    ) => Promise<{
      recordsRead: number;
      recordsUpserted: number;
      recordsFailed: number;
      pagesProcessed: number;
      status: SyncStatus;
      errorMessage?: string;
      errorDetails?: SyncErrorDetail[];
    }>,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    const log = await prisma.syncLog.create({
      data: { entity, status: "STARTED", trigger },
    });

    const onProgress = async (p: ProgressUpdate) => {
      await prisma.syncLog.update({
        where: { id: log.id },
        data: {
          recordsRead: p.recordsRead,
          recordsUpserted: p.recordsUpserted,
          recordsFailed: p.recordsFailed,
          metadata: p as unknown as Prisma.InputJsonValue,
        },
      });
    };

    try {
      const result = await fn(onProgress, signal);

      const metadata = { pagesProcessed: result.pagesProcessed } as unknown as Prisma.InputJsonValue;
      if (result.errorDetails?.length) {
        (metadata as unknown as Record<string, unknown>).errors = result.errorDetails;
      }

      if (signal?.aborted) {
        await prisma.syncLog.update({
          where: { id: log.id },
          data: {
            status: "PARTIAL",
            recordsRead: result.recordsRead,
            recordsUpserted: result.recordsUpserted,
            recordsFailed: result.recordsFailed,
            errorMessage: "سینک توسط کاربر لغو شد",
            metadata,
            finishedAt: new Date(),
          },
        });
        return { entity, ...result, status: "PARTIAL", errorMessage: "سینک توسط کاربر لغو شد" };
      }

      await prisma.syncLog.update({
        where: { id: log.id },
        data: {
          status: result.status,
          recordsRead: result.recordsRead,
          recordsUpserted: result.recordsUpserted,
          recordsFailed: result.recordsFailed,
          errorMessage: result.errorMessage,
          metadata,
          finishedAt: new Date(),
        },
      });
      return { entity, ...result };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown sync error";
      const isAborted = signal?.aborted || message.includes("لغو شد");
      const status: SyncStatus = isAborted ? "PARTIAL" : "FAILED";
      await prisma.syncLog.update({
        where: { id: log.id },
        data: { status, errorMessage: message, finishedAt: new Date() },
      });
      return {
        entity,
        status,
        recordsRead: 0,
        recordsUpserted: 0,
        recordsFailed: 0,
        pagesProcessed: 0,
        errorMessage: message,
      };
    }
  }
}
