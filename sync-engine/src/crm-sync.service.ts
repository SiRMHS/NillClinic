import { prisma, SyncEntity, SyncStatus, SyncTrigger } from "@jordan/db";
import type { EncryptFn } from "./types.js";
import { ConflictResolver } from "./conflict.resolver.js";
import { JordanApiClient } from "./jordan-api.client.js";
import { MappingEngine } from "./mapping.engine.js";

export interface SyncResult {
  entity: SyncEntity;
  status: SyncStatus;
  recordsRead: number;
  recordsUpserted: number;
  recordsFailed: number;
  errorMessage?: string;
  pagesProcessed: number;
  metadata?: Record<string, unknown>;
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
    const entities = config?.entities ?? ["PATIENTS", "SERVICES", "RESERVES", "TREATMENTS"];
    const results: SyncResult[] = [];

    for (const entity of entities) {
      if (config?.signal?.aborted) break;
      switch (entity) {
        case "PATIENTS":
          results.push(await this.syncPatients(trigger, config));
          break;
        case "SERVICES":
          results.push(await this.syncServices(trigger, config));
          break;
        case "RESERVES":
          results.push(await this.syncReserves(trigger, config));
          break;
        case "TREATMENTS":
          results.push(await this.syncTreatments(trigger, config));
          break;
      }
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

      for (let page = 1; page <= maxPages; page++) {
        if (signal?.aborted) throw new Error("سینک توسط کاربر لغو شد");
        const raw = await this.api.getPatients({ page, pageSize });
        if (!raw.length) break;

        const { valid, invalid: parseInvalid } = this.mapper.mapPatients(raw);
        totalRead += raw.length;
        totalFailed += parseInvalid;

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
          } catch {
            totalFailed++;
          }
        }

        pagesProcessed = page;
        await onProgress({ recordsRead: totalRead, recordsUpserted: totalUpserted, recordsFailed: totalFailed, pagesProcessed });
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

      for (let page = 1; page <= maxPages; page++) {
        if (signal?.aborted) throw new Error("سینک توسط کاربر لغو شد");
        const raw = await this.api.getServices({ page, pageSize });
        if (!raw.length) break;

        const { valid, invalid: parseInvalid } = this.mapper.mapServices(raw);
        totalRead += raw.length;
        totalFailed += parseInvalid;

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
                name: data.srvName,
                sectionName: data.secName,
                tariff: data.tarriff,
                syncedAt: new Date(),
              },
            });
            totalUpserted++;
          } catch {
            totalFailed++;
          }
        }

        pagesProcessed = page;
        await onProgress({ recordsRead: totalRead, recordsUpserted: totalUpserted, recordsFailed: totalFailed, pagesProcessed });
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

      for (let page = 1; page <= maxPages; page++) {
        if (signal?.aborted) throw new Error("سینک توسط کاربر لغو شد");
        const raw = await this.api.getReserves({ page, pageSize });
        if (!raw.length) break;

        const { valid, invalid: parseInvalid } = this.mapper.mapReserves(raw);
        totalRead += raw.length;
        totalFailed += parseInvalid;

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
          } catch {
            totalFailed++;
          }
        }

        pagesProcessed = page;
        await onProgress({ recordsRead: totalRead, recordsUpserted: totalUpserted, recordsFailed: totalFailed, pagesProcessed });
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

      for (let page = 1; page <= maxPages; page++) {
        if (signal?.aborted) throw new Error("سینک توسط کاربر لغو شد");
        const raw = await this.api.getTreatments({ page, pageSize });
        if (!raw.length) break;

        const { valid, invalid: parseInvalid } = this.mapper.mapTreatments(raw);
        totalRead += raw.length;
        totalFailed += parseInvalid;

        for (const { externalId, data } of valid) {
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
                detailsJson: data.treatmentPlanDetails as object,
                isDeleted: data.treatmentPlanDeleted,
                syncedAt: new Date(),
              },
              update: {
                planDate: data.treatmentPlanDate,
                planName: data.treatmentPlanName,
                planUser: data.treatmentPlanUser,
                reasonName: data.treatmentPlanReasonName,
                detailsJson: data.treatmentPlanDetails as object,
                isDeleted: data.treatmentPlanDeleted,
                syncedAt: new Date(),
              },
            });
            totalUpserted++;
          } catch {
            totalFailed++;
          }
        }

        pagesProcessed = page;
        await onProgress({ recordsRead: totalRead, recordsUpserted: totalUpserted, recordsFailed: totalFailed, pagesProcessed });
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
      };
    }, config?.signal);
  }

  private async runSync(
    entity: SyncEntity,
    trigger: SyncTrigger,
    fn: (
      onProgress: (p: { recordsRead: number; recordsUpserted: number; recordsFailed: number; pagesProcessed: number }) => Promise<void>,
      signal?: AbortSignal,
    ) => Promise<{
      recordsRead: number;
      recordsUpserted: number;
      recordsFailed: number;
      pagesProcessed: number;
      status: SyncStatus;
      errorMessage?: string;
    }>,
    signal?: AbortSignal,
  ): Promise<SyncResult> {
    const log = await prisma.syncLog.create({
      data: { entity, status: "STARTED", trigger },
    });

    const onProgress = async (p: { recordsRead: number; recordsUpserted: number; recordsFailed: number; pagesProcessed: number }) => {
      await prisma.syncLog.update({
        where: { id: log.id },
        data: {
          recordsRead: p.recordsRead,
          recordsUpserted: p.recordsUpserted,
          recordsFailed: p.recordsFailed,
          metadata: { pagesProcessed: p.pagesProcessed },
        },
      });
    };

    try {
      const result = await fn(onProgress, signal);

      if (signal?.aborted) {
        await prisma.syncLog.update({
          where: { id: log.id },
          data: {
            status: "PARTIAL",
            recordsRead: result.recordsRead,
            recordsUpserted: result.recordsUpserted,
            recordsFailed: result.recordsFailed,
            errorMessage: "سینک توسط کاربر لغو شد",
            metadata: { pagesProcessed: result.pagesProcessed },
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
          metadata: { pagesProcessed: result.pagesProcessed },
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
