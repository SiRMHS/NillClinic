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
  reachedEnd?: boolean;
  errors?: SyncErrorDetail[];
}

export interface JobStateUpdate extends ProgressUpdate {
  entity: SyncEntity;
  lastPage: number;
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
  fullSync?: boolean;
  throttleDelayMs?: number;
  startPage?: number;
  accumulateFrom?: { recordsRead: number; recordsUpserted: number; recordsFailed: number };
  onJobState?: (update: JobStateUpdate) => Promise<void>;
}

const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_MAX_PAGES = 2;
const MAX_FULL_SYNC_PAGES = 200000;
const DEFAULT_THROTTLE_MS = 500;

export const ALL_SYNC_ENTITIES: SyncEntity[] = [
  "PATIENTS",
  "SERVICES",
  "RESERVES",
  "TREATMENTS",
  "RECEPTIONS",
];

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(t);
      reject(new Error("سینک توسط کاربر لغو شد"));
    };
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

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

  async syncAllAuto(
    opts: {
      signal?: AbortSignal;
      entities?: SyncEntity[];
      throttleDelayMs?: number;
      pageSize?: number;
    } = {},
  ): Promise<void> {
    const entities = opts.entities ?? ALL_SYNC_ENTITIES;
    for (const entity of entities) {
      if (opts.signal?.aborted) break;
      try {
        await this.syncEntityAuto(entity, opts);
      } catch (err) {
        if (opts.signal?.aborted) break;
        const message = err instanceof Error ? err.message : "خطای سینک خودکار";
        await prisma.syncJobState.update({
          where: { entity },
          data: { status: "FAILED", errorMessage: message, finishedAt: new Date() },
        }).catch(() => {});
      }
    }
  }

  private async syncEntityAuto(
    entity: SyncEntity,
    opts: { signal?: AbortSignal; throttleDelayMs?: number; pageSize?: number },
  ): Promise<void> {
    const job = await prisma.syncJobState.upsert({
      where: { entity },
      create: { entity },
      update: {},
    });

    if (job.reachedEnd) return;

    const startPage = Math.max(1, job.lastPage ?? 1);
    const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE;
    const throttleDelayMs = opts.throttleDelayMs ?? DEFAULT_THROTTLE_MS;

    await prisma.syncJobState.update({
      where: { entity },
      data: {
        status: "RUNNING",
        startedAt: job.startedAt ?? new Date(),
        errorMessage: null,
        finishedAt: null,
      },
    });

    let reachedEnd = false;

    const onJobState = async (u: JobStateUpdate) => {
      reachedEnd = u.reachedEnd === true;
      await prisma.syncJobState.update({
        where: { entity },
        data: {
          lastPage: u.lastPage,
          recordsRead: u.recordsRead,
          recordsUpserted: u.recordsUpserted,
          recordsFailed: u.recordsFailed,
          reachedEnd: u.reachedEnd === true,
        },
      }).catch(() => {});
    };

    const config: SyncConfig = {
      signal: opts.signal,
      fullSync: true,
      startPage,
      pageSize,
      throttleDelayMs,
      accumulateFrom: {
        recordsRead: job.recordsRead,
        recordsUpserted: job.recordsUpserted,
        recordsFailed: job.recordsFailed,
      },
      onJobState,
    };

    let result: SyncResult;
    try {
      switch (entity) {
        case "PATIENTS":
          result = await this.syncPatients("AUTO", config);
          break;
        case "SERVICES":
          result = await this.syncServices("AUTO", config);
          break;
        case "RESERVES":
          result = await this.syncReserves("AUTO", config);
          break;
        case "TREATMENTS":
          result = await this.syncTreatments("AUTO", config);
          break;
        case "RECEPTIONS":
          result = await this.syncReceptions("AUTO", config);
          break;
        default:
          return;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "خطای سینک خودکار";
      const aborted = opts.signal?.aborted || message.includes("لغو شد");
      await prisma.syncJobState.update({
        where: { entity },
        data: {
          status: aborted ? "PARTIAL" : "FAILED",
          errorMessage: message,
          finishedAt: new Date(),
        },
      }).catch(() => {});
      throw err;
    }

    await prisma.syncJobState.update({
      where: { entity },
      data: {
        status: reachedEnd ? "COMPLETED" : (opts.signal?.aborted ? "PARTIAL" : (result.status === "FAILED" ? "FAILED" : "PARTIAL")),
        reachedEnd,
        errorMessage: result.errorMessage,
        finishedAt: new Date(),
      },
    }).catch(() => {});
  }

  async syncPatients(trigger: SyncTrigger, config?: SyncConfig): Promise<SyncResult> {
    return this.runSync("PATIENTS", trigger, async (onProgress, signal) => {
      const maxPages = config?.maxPages ?? DEFAULT_MAX_PAGES;
      const pageSize = config?.pageSize ?? DEFAULT_PAGE_SIZE;
      const startPage = config?.startPage ?? 1;
      const fullSync = config?.fullSync === true;
      let totalRead = config?.accumulateFrom?.recordsRead ?? 0;
      let totalUpserted = config?.accumulateFrom?.recordsUpserted ?? 0;
      let totalFailed = config?.accumulateFrom?.recordsFailed ?? 0;
      let pagesProcessed = startPage - 1;
      const allErrors: SyncErrorDetail[] = [];

      for (let page = startPage; fullSync ? page < startPage + MAX_FULL_SYNC_PAGES : page <= maxPages; page++) {
        if (signal?.aborted) throw new Error("سینک توسط کاربر لغو شد");
        const raw = await this.api.getPatients({ page, pageSize });
        if (!raw.length) {
          if (fullSync) {
            await onProgress({ recordsRead: totalRead, recordsUpserted: totalUpserted, recordsFailed: totalFailed, pagesProcessed: page - 1, reachedEnd: true, errors: allErrors });
          }
          break;
        }

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
        const reachedEnd = fullSync && raw.length < pageSize;
        await onProgress({ recordsRead: totalRead, recordsUpserted: totalUpserted, recordsFailed: totalFailed, pagesProcessed, reachedEnd, errors: allErrors });
        if (reachedEnd) break;
        if (fullSync) await delay(config?.throttleDelayMs ?? DEFAULT_THROTTLE_MS, signal);
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
    }, config);
  }

  async syncServices(trigger: SyncTrigger, config?: SyncConfig): Promise<SyncResult> {
    return this.runSync("SERVICES", trigger, async (onProgress, signal) => {
      const maxPages = config?.maxPages ?? DEFAULT_MAX_PAGES;
      const pageSize = config?.pageSize ?? DEFAULT_PAGE_SIZE;
      const startPage = config?.startPage ?? 1;
      const fullSync = config?.fullSync === true;
      let totalRead = config?.accumulateFrom?.recordsRead ?? 0;
      let totalUpserted = config?.accumulateFrom?.recordsUpserted ?? 0;
      let totalFailed = config?.accumulateFrom?.recordsFailed ?? 0;
      let pagesProcessed = startPage - 1;
      const allErrors: SyncErrorDetail[] = [];

      for (let page = startPage; fullSync ? page < startPage + MAX_FULL_SYNC_PAGES : page <= maxPages; page++) {
        if (signal?.aborted) throw new Error("سینک توسط کاربر لغو شد");
        const raw = await this.api.getServices({ page, pageSize });
        if (!raw.length) {
          if (fullSync) {
            await onProgress({ recordsRead: totalRead, recordsUpserted: totalUpserted, recordsFailed: totalFailed, pagesProcessed: page - 1, reachedEnd: true, errors: allErrors });
          }
          break;
        }

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
        const reachedEnd = fullSync && raw.length < pageSize;
        await onProgress({ recordsRead: totalRead, recordsUpserted: totalUpserted, recordsFailed: totalFailed, pagesProcessed, reachedEnd, errors: allErrors });
        if (reachedEnd) break;
        if (fullSync) await delay(config?.throttleDelayMs ?? DEFAULT_THROTTLE_MS, signal);
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
    }, config);
  }

  async syncReserves(trigger: SyncTrigger, config?: SyncConfig): Promise<SyncResult> {
    return this.runSync("RESERVES", trigger, async (onProgress, signal) => {
      const maxPages = config?.maxPages ?? DEFAULT_MAX_PAGES;
      const pageSize = config?.pageSize ?? DEFAULT_PAGE_SIZE;
      const startPage = config?.startPage ?? 1;
      const fullSync = config?.fullSync === true;
      let totalRead = config?.accumulateFrom?.recordsRead ?? 0;
      let totalUpserted = config?.accumulateFrom?.recordsUpserted ?? 0;
      let totalFailed = config?.accumulateFrom?.recordsFailed ?? 0;
      let pagesProcessed = startPage - 1;
      const allErrors: SyncErrorDetail[] = [];

      for (let page = startPage; fullSync ? page < startPage + MAX_FULL_SYNC_PAGES : page <= maxPages; page++) {
        if (signal?.aborted) throw new Error("سینک توسط کاربر لغو شد");
        const raw = await this.api.getReserves({ page, pageSize });
        if (!raw.length) {
          if (fullSync) {
            await onProgress({ recordsRead: totalRead, recordsUpserted: totalUpserted, recordsFailed: totalFailed, pagesProcessed: page - 1, reachedEnd: true, errors: allErrors });
          }
          break;
        }

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
        const reachedEnd = fullSync && raw.length < pageSize;
        await onProgress({ recordsRead: totalRead, recordsUpserted: totalUpserted, recordsFailed: totalFailed, pagesProcessed, reachedEnd, errors: allErrors });
        if (reachedEnd) break;
        if (fullSync) await delay(config?.throttleDelayMs ?? DEFAULT_THROTTLE_MS, signal);
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
    }, config);
  }

  async syncTreatments(trigger: SyncTrigger, config?: SyncConfig): Promise<SyncResult> {
    return this.runSync("TREATMENTS", trigger, async (onProgress, signal) => {
      const maxPages = config?.maxPages ?? DEFAULT_MAX_PAGES;
      const pageSize = config?.pageSize ?? DEFAULT_PAGE_SIZE;
      const startPage = config?.startPage ?? 1;
      const fullSync = config?.fullSync === true;
      let totalRead = config?.accumulateFrom?.recordsRead ?? 0;
      let totalUpserted = config?.accumulateFrom?.recordsUpserted ?? 0;
      let totalFailed = config?.accumulateFrom?.recordsFailed ?? 0;
      let pagesProcessed = startPage - 1;
      const allErrors: SyncErrorDetail[] = [];

      for (let page = startPage; fullSync ? page < startPage + MAX_FULL_SYNC_PAGES : page <= maxPages; page++) {
        if (signal?.aborted) throw new Error("سینک توسط کاربر لغو شد");
        const raw = await this.api.getTreatments({ page, pageSize });
        if (!raw.length) {
          if (fullSync) {
            await onProgress({ recordsRead: totalRead, recordsUpserted: totalUpserted, recordsFailed: totalFailed, pagesProcessed: page - 1, reachedEnd: true, errors: allErrors });
          }
          break;
        }

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
        const reachedEnd = fullSync && raw.length < pageSize;
        await onProgress({ recordsRead: totalRead, recordsUpserted: totalUpserted, recordsFailed: totalFailed, pagesProcessed, reachedEnd, errors: allErrors });
        if (reachedEnd) break;
        if (fullSync) await delay(config?.throttleDelayMs ?? DEFAULT_THROTTLE_MS, signal);
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
    }, config);
  }

  async syncReceptions(trigger: SyncTrigger, config?: SyncConfig): Promise<SyncResult> {
    return this.runSync("RECEPTIONS", trigger, async (onProgress, signal) => {
      const maxPages = config?.maxPages ?? DEFAULT_MAX_PAGES;
      const pageSize = config?.pageSize ?? DEFAULT_PAGE_SIZE;
      const startPage = config?.startPage ?? 1;
      const fullSync = config?.fullSync === true;
      let totalRead = config?.accumulateFrom?.recordsRead ?? 0;
      let totalUpserted = config?.accumulateFrom?.recordsUpserted ?? 0;
      let totalFailed = config?.accumulateFrom?.recordsFailed ?? 0;
      let pagesProcessed = startPage - 1;
      const allErrors: SyncErrorDetail[] = [];

      for (let page = startPage; fullSync ? page < startPage + MAX_FULL_SYNC_PAGES : page <= maxPages; page++) {
        if (signal?.aborted) throw new Error("سینک توسط کاربر لغو شد");
        const raw = await this.api.getReceptions({ page, pageSize, fromDate: "1400/01/01" });
        if (!raw.length) {
          if (fullSync) {
            await onProgress({ recordsRead: totalRead, recordsUpserted: totalUpserted, recordsFailed: totalFailed, pagesProcessed: page - 1, reachedEnd: true, errors: allErrors });
          }
          break;
        }

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
        const reachedEnd = fullSync && raw.length < pageSize;
        await onProgress({ recordsRead: totalRead, recordsUpserted: totalUpserted, recordsFailed: totalFailed, pagesProcessed, reachedEnd, errors: allErrors });
        if (reachedEnd) break;
        if (fullSync) await delay(config?.throttleDelayMs ?? DEFAULT_THROTTLE_MS, signal);
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
    }, config);
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
    config?: SyncConfig,
  ): Promise<SyncResult> {
    const signal = config?.signal;
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
      if (config?.onJobState) {
        await config.onJobState({
          ...p,
          entity,
          lastPage: p.pagesProcessed + 1,
        });
      }
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
