import { prisma, SyncEntity, SyncStatus, SyncTrigger, Prisma } from "@jordan/db";
import { addJalaliDays, jalaliToday, jalaliWindows, type JalaliWindow } from "@jordan/shared";
import { bulkInsert, bulkUpsert, loadPatientIdMap, newId } from "./bulk.js";
import { JordanApiClient } from "./jordan-api.client.js";
import { MappingEngine, type MappedInvalid } from "./mapping.engine.js";
import type { EncryptFn } from "./types.js";

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
  /** Jalali cursor for date-windowed entities. */
  cursorDate?: string | null;
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
  /** Oldest Jalali date to backfill for date-windowed entities. */
  historyStart?: string;
  /** Jalali cursor to resume a date-windowed entity from. */
  startDate?: string;
  /**
   * Last Jalali date to read, inclusive. Defaults to today. Reserves are the
   * reason this exists: appointments are booked ahead, so a refresh that stops
   * at today would never see tomorrow's bookings.
   */
  endDate?: string;
  /** Window width in days for date-windowed entities. */
  windowDays?: number;
  /** Concurrent windows in flight. */
  concurrency?: number;
}

export interface IncrementalOptions {
  signal?: AbortSignal;
  entities?: SyncEntity[];
  /** Days of history each pass re-reads, to catch edits to already-synced rows. */
  lookbackDays?: number;
  /** Days of future bookings to read; only reserves are future-dated. */
  lookaheadDays?: number;
  pageSize?: number;
  throttleDelayMs?: number;
  concurrency?: number;
}

export interface IncrementalRunSummary {
  results: SyncResult[];
  skipped: { entity: SyncEntity; reason: string }[];
  range: { from: string; to: string; forwardTo: string };
}

const DEFAULT_PAGE_SIZE = 1000;
const DEFAULT_MAX_PAGES = 2;
const DEFAULT_THROTTLE_MS = 0;
// Measured on this CRM: 8 concurrent reception windows average 2.7s each
// versus 4.1s at concurrency 4 and ~15s issued serially. Beyond 8 the server
// saturates and per-request latency climbs faster than throughput improves.
const DEFAULT_CONCURRENCY = 8;

/**
 * Receptions hold ~50-250 rows/day and the endpoint's cost is driven by offset
 * depth, so a 3-day window almost always fits in a single 1000-row page.
 */
const DEFAULT_RECEPTION_WINDOW_DAYS = 3;
/** Treatments are far sparser; a wide window still returns in a few seconds. */
const DEFAULT_TREATMENT_WINDOW_DAYS = 90;
/** Reserves sit between the two in density when read by date. */
const DEFAULT_RESERVE_WINDOW_DAYS = 7;

/** Incremental defaults: one week back, one month of booked appointments ahead. */
export const DEFAULT_LOOKBACK_DAYS = 7;
export const DEFAULT_LOOKAHEAD_DAYS = 30;
/**
 * How many trailing offset pages the incremental pass re-reads for patients.
 * The patient endpoint has no date filter, so "recent" can only mean "the end
 * of the list" — three pages of 1000 is ample headroom for an hour of new
 * registrations while still costing three requests instead of a hundred.
 */
const PATIENT_TAIL_PAGES = 3;

/** Reception data begins around 1400; earlier windows return empty in ~1.5s. */
const DEFAULT_HISTORY_START = "1397/01/01";

/**
 * Backstop for offset-paged entities. Patients (~125 pages) and reserves
 * (~300 pages) are far below this; hitting it means the CRM changed behaviour.
 */
const MAX_OFFSET_PAGES = 5_000;

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

function toErrorDetails(invalid: MappedInvalid[], context: string): SyncErrorDetail[] {
  return invalid.map((i) => ({ recordId: `${context} #${i.recordId}`, message: i.message }));
}

/** Cap retained error samples so one bad page cannot bloat the log row. */
const MAX_RETAINED_ERRORS = 200;

interface Counters {
  read: number;
  upserted: number;
  failed: number;
  pages: number;
  errors: SyncErrorDetail[];
}

export class CrmSyncService {
  private readonly mapper = new MappingEngine();

  constructor(
    private readonly api: JordanApiClient,
    private readonly encrypt: EncryptFn,
  ) {}

  async syncAll(trigger: SyncTrigger = "CRON", config?: SyncConfig): Promise<SyncResult[]> {
    const entities = config?.entities ?? ALL_SYNC_ENTITIES;
    const results: SyncResult[] = [];

    for (const entity of entities) {
      if (config?.signal?.aborted) break;
      results.push(await this.syncEntity(entity, trigger, config));
      if (config?.signal?.aborted) break;
    }

    return results;
  }

  syncEntity(entity: SyncEntity, trigger: SyncTrigger, config?: SyncConfig): Promise<SyncResult> {
    switch (entity) {
      case "PATIENTS":
        return this.syncPatients(trigger, config);
      case "SERVICES":
        return this.syncServices(trigger, config);
      case "RESERVES":
        return this.syncReserves(trigger, config);
      case "TREATMENTS":
        return this.syncTreatments(trigger, config);
      case "RECEPTIONS":
        return this.syncReceptions(trigger, config);
      default:
        return Promise.resolve({
          entity,
          status: "FAILED" as SyncStatus,
          recordsRead: 0,
          recordsUpserted: 0,
          recordsFailed: 0,
          pagesProcessed: 0,
          errorMessage: `موجودیت ناشناخته: ${entity}`,
        });
    }
  }

  // ─── Incremental driver (scheduled refresh) ───

  /**
   * A short pass over only the recent slice of the CRM, meant to run on a
   * repeating schedule (hourly by default) once the full sync has finished.
   *
   * The full sync exists to load everything once and stops when it reaches the
   * end; nothing then keeps the data current. This does that job instead, and
   * it has to be cheap enough to run every hour, so each entity is narrowed the
   * only way its endpoint allows:
   *
   *   • RECEPTIONS / TREATMENTS — date-filtered, so they read `lookbackDays`
   *     back. The window is not just "since the last run": rows are edited
   *     after the fact (a payment settled the next day), so re-reading a few
   *     days each time is what catches those edits.
   *   • RESERVES — date-filtered too, but forward-looking, so the range runs
   *     from `lookbackDays` back to `lookaheadDays` ahead.
   *   • SERVICES — the whole catalogue is one request; no narrowing needed.
   *   • PATIENTS — the endpoint offers no date filter at all, so the pass
   *     re-reads the last few offset pages, where newly registered patients
   *     land. It is skipped until a full sync has established where the list
   *     ends, because from a cold start "the last few pages" is the whole
   *     table.
   *
   * Job-state checkpoints are deliberately untouched: this is a repeating
   * refresh, not a resumable walk, and writing to them would make the full
   * sync think it had progressed.
   */
  async syncAllIncremental(opts: IncrementalOptions = {}): Promise<IncrementalRunSummary> {
    const entities = opts.entities?.length ? opts.entities : ALL_SYNC_ENTITIES;
    const lookback = Math.max(0, opts.lookbackDays ?? DEFAULT_LOOKBACK_DAYS);
    const lookahead = Math.max(0, opts.lookaheadDays ?? DEFAULT_LOOKAHEAD_DAYS);

    const today = jalaliToday();
    const from = addJalaliDays(today, -lookback);
    const forwardTo = addJalaliDays(today, lookahead);

    const base: SyncConfig = {
      signal: opts.signal,
      pageSize: opts.pageSize ?? DEFAULT_PAGE_SIZE,
      throttleDelayMs: opts.throttleDelayMs ?? DEFAULT_THROTTLE_MS,
      concurrency: opts.concurrency,
    };

    const results: SyncResult[] = [];
    const skipped: { entity: SyncEntity; reason: string }[] = [];

    for (const entity of entities) {
      if (opts.signal?.aborted) break;

      try {
        switch (entity) {
          case "SERVICES":
            results.push(await this.syncServices("CRON", { ...base }));
            break;

          case "RECEPTIONS":
            results.push(
              await this.syncReceptions("CRON", {
                ...base,
                startDate: from,
                endDate: today,
                windowDays: Math.max(1, Math.min(lookback + 1, DEFAULT_RECEPTION_WINDOW_DAYS)),
              }),
            );
            break;

          case "TREATMENTS":
            results.push(
              await this.syncTreatments("CRON", {
                ...base,
                startDate: from,
                endDate: today,
                windowDays: Math.max(1, lookback + 1),
              }),
            );
            break;

          case "RESERVES":
            results.push(
              await this.syncReservesRange("CRON", {
                ...base,
                startDate: from,
                endDate: forwardTo,
                windowDays: DEFAULT_RESERVE_WINDOW_DAYS,
              }),
            );
            break;

          case "PATIENTS": {
            const job = await prisma.syncJobState.findUnique({ where: { entity: "PATIENTS" } });
            if (!job?.reachedEnd) {
              skipped.push({
                entity,
                reason: "سینک کامل بیماران هنوز تمام نشده — تا آن زمان سینک ساعتی بیماران را رد می‌کند",
              });
              break;
            }
            const startPage = Math.max(1, (job.lastPage ?? 1) - PATIENT_TAIL_PAGES + 1);
            results.push(
              await this.syncPatients("CRON", {
                ...base,
                // fullSync so the tail is walked to the true end rather than
                // stopping after maxPages — it is only a handful of pages.
                fullSync: true,
                startPage,
              }),
            );
            break;
          }

          default:
            skipped.push({ entity, reason: `موجودیت ناشناخته: ${entity}` });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "خطای سینک ساعتی";
        if (opts.signal?.aborted) break;
        results.push({
          entity,
          status: "FAILED" as SyncStatus,
          recordsRead: 0,
          recordsUpserted: 0,
          recordsFailed: 0,
          pagesProcessed: 0,
          errorMessage: message,
        });
      }
    }

    return {
      results,
      skipped,
      range: { from, to: today, forwardTo },
    };
  }

  // ─── Auto/resumable driver ───

  async syncAllAuto(
    opts: {
      signal?: AbortSignal;
      entities?: SyncEntity[];
      throttleDelayMs?: number;
      pageSize?: number;
      windowDays?: number;
      concurrency?: number;
      historyStart?: string;
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
        await prisma.syncJobState
          .update({
            where: { entity },
            data: { status: "FAILED", errorMessage: message, finishedAt: new Date() },
          })
          .catch(() => {});
      }
    }
  }

  private async syncEntityAuto(
    entity: SyncEntity,
    opts: {
      signal?: AbortSignal;
      throttleDelayMs?: number;
      pageSize?: number;
      windowDays?: number;
      concurrency?: number;
      historyStart?: string;
    },
  ): Promise<void> {
    const job = await prisma.syncJobState.upsert({
      where: { entity },
      create: { entity },
      update: {},
    });

    if (job.reachedEnd) return;

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
      await prisma.syncJobState
        .update({
          where: { entity },
          data: {
            lastPage: u.lastPage,
            cursorDate: u.cursorDate ?? undefined,
            recordsRead: u.recordsRead,
            recordsUpserted: u.recordsUpserted,
            recordsFailed: u.recordsFailed,
            reachedEnd: u.reachedEnd === true,
          },
        })
        .catch(() => {});
    };

    const config: SyncConfig = {
      signal: opts.signal,
      fullSync: true,
      startPage: Math.max(1, job.lastPage ?? 1),
      startDate: job.cursorDate ?? undefined,
      pageSize: opts.pageSize ?? DEFAULT_PAGE_SIZE,
      throttleDelayMs: opts.throttleDelayMs ?? DEFAULT_THROTTLE_MS,
      windowDays: opts.windowDays,
      concurrency: opts.concurrency,
      historyStart: opts.historyStart,
      accumulateFrom: {
        recordsRead: job.recordsRead,
        recordsUpserted: job.recordsUpserted,
        recordsFailed: job.recordsFailed,
      },
      onJobState,
    };

    let result: SyncResult;
    try {
      result = await this.syncEntity(entity, "AUTO", config);
    } catch (err) {
      const message = err instanceof Error ? err.message : "خطای سینک خودکار";
      const aborted = opts.signal?.aborted || message.includes("لغو شد");
      await prisma.syncJobState
        .update({
          where: { entity },
          data: {
            status: aborted ? "PARTIAL" : "FAILED",
            errorMessage: message,
            finishedAt: new Date(),
          },
        })
        .catch(() => {});
      throw err;
    }

    await prisma.syncJobState
      .update({
        where: { entity },
        data: {
          status: reachedEnd
            ? "COMPLETED"
            : opts.signal?.aborted
              ? "PARTIAL"
              : result.status === "FAILED"
                ? "FAILED"
                : "PARTIAL",
          reachedEnd,
          errorMessage: result.errorMessage,
          finishedAt: new Date(),
        },
      })
      .catch(() => {});
  }

  // ─── SERVICES: endpoint ignores paging entirely ───

  async syncServices(trigger: SyncTrigger, config?: SyncConfig): Promise<SyncResult> {
    return this.runSync("SERVICES", trigger, async (onProgress, signal) => {
      const c = this.newCounters(config);

      // A single request returns the whole catalogue. Paging it produced
      // 68,984,734 redundant upserts of the same ~218 rows previously, because
      // page 500 is byte-identical to page 1 and the loop's only exit was
      // `rows.length < pageSize`.
      const raw = await this.api.getServices(signal);
      const { valid, invalid } = this.mapper.mapServices(raw);

      c.read += raw.length;
      c.failed += invalid.length;
      this.pushErrors(c, toErrorDetails(invalid, "services"));

      if (valid.length) {
        const now = new Date();
        c.upserted += await bulkUpsert({
          table: "services",
          columns: [
            { name: "id" },
            { name: "external_id" },
            { name: "name" },
            { name: "section_name" },
            { name: "section_id" },
            { name: "tariff" },
            { name: "synced_at", cast: "timestamp" },
            { name: "updated_at", cast: "timestamp" },
          ],
          rows: valid.map((v) => [
            newId(),
            v.externalId,
            v.data.srvName,
            v.data.secName,
            v.data.sectionId,
            v.data.tarriff,
            now,
            now,
          ]),
          conflictColumns: ["external_id"],
          updateColumns: ["name", "section_name", "section_id", "tariff", "synced_at", "updated_at"],
        });
      }

      c.pages = 1;
      await onProgress({ ...this.progress(c), reachedEnd: true });

      return { ...this.progress(c), status: this.statusOf(c), errorDetails: c.errors };
    }, config);
  }

  // ─── PATIENTS / RESERVES: true offset pagination ───

  async syncPatients(trigger: SyncTrigger, config?: SyncConfig): Promise<SyncResult> {
    return this.runSync("PATIENTS", trigger, async (onProgress, signal) => {
      return this.runOffsetSync({
        config,
        signal,
        onProgress,
        label: "patients",
        fetch: (page, pageSize) => this.api.getPatients({ page, pageSize }, signal),
        signatureOf: (raw) =>
          raw.map((r) => String((r as { patientCode?: unknown })?.patientCode)).join(","),
        persist: async (raw, c) => {
          const { valid, invalid } = this.mapper.mapPatients(raw);
          c.failed += invalid.length;
          this.pushErrors(c, toErrorDetails(invalid, "patients"));
          if (!valid.length) return 0;

          const now = new Date();
          return bulkUpsert({
            table: "patients",
            columns: [
              { name: "id" },
              { name: "external_code" },
              { name: "full_name_enc" },
              { name: "full_name" },
              { name: "mobile_enc" },
              { name: "mobile" },
              { name: "tel_enc" },
              { name: "gender" },
              { name: "address_enc" },
              { name: "degree" },
              { name: "father_name_enc" },
              { name: "birth_date" },
              { name: "resident_country" },
              { name: "introduction" },
              { name: "job" },
              { name: "is_resident" },
              { name: "synced_at", cast: "timestamp" },
              { name: "updated_at", cast: "timestamp" },
            ],
            rows: valid.map(({ externalCode, plaintext: p }) => [
              newId(),
              externalCode,
              this.encrypt(p.fullName),
              p.fullName,
              p.mobile ? this.encrypt(p.mobile) : null,
              p.mobile,
              p.tel ? this.encrypt(p.tel) : null,
              p.gender,
              p.address ? this.encrypt(p.address) : null,
              p.degree,
              p.fatherName ? this.encrypt(p.fatherName) : null,
              p.birthDate,
              p.residentCountry,
              p.introduction,
              p.job,
              p.isResident,
              now,
              now,
            ]),
            conflictColumns: ["external_code"],
            updateColumns: [
              "full_name_enc",
              "full_name",
              "mobile_enc",
              "mobile",
              "tel_enc",
              "gender",
              "address_enc",
              "degree",
              "father_name_enc",
              "birth_date",
              "resident_country",
              "introduction",
              "job",
              "is_resident",
              "synced_at",
              "updated_at",
            ],
          });
        },
      });
    }, config);
  }

  async syncReserves(trigger: SyncTrigger, config?: SyncConfig): Promise<SyncResult> {
    return this.runSync("RESERVES", trigger, async (onProgress, signal) => {
      const patientIds = await loadPatientIdMap();

      return this.runOffsetSync({
        config,
        signal,
        onProgress,
        label: "reserves",
        fetch: (page, pageSize) => this.api.getReserves({ page, pageSize }, signal),
        signatureOf: (raw) =>
          raw
            .map((r) => {
              const x = r as { reserveDate?: unknown; reserveTime?: unknown; patientCode?: unknown };
              return `${x?.reserveDate}|${x?.reserveTime}|${x?.patientCode}`;
            })
            .join(","),
        persist: (raw, c) => this.persistReserves(raw, c, patientIds),
      });
    }, config);
  }

  /**
   * Reserves restricted to a Jalali date range, for the incremental pass.
   *
   * The full sync walks reserves by offset because it has to read all of them,
   * but a repeating refresh only cares about the days around today — and unlike
   * every other entity, reserves are *future*-dated, so the range has to extend
   * past today or tomorrow's appointments never arrive.
   */
  async syncReservesRange(trigger: SyncTrigger, config?: SyncConfig): Promise<SyncResult> {
    return this.runSync("RESERVES", trigger, async (onProgress, signal) => {
      const patientIds = await loadPatientIdMap();

      return this.runWindowedSync({
        config,
        signal,
        onProgress,
        windowDays: config?.windowDays ?? DEFAULT_RESERVE_WINDOW_DAYS,
        paged: true,
        fetch: (window, page, pageSize) =>
          this.api.getReserves(
            { fromDate: window.from, toDate: window.to, page, pageSize },
            signal,
          ),
        persist: (raw, c) => this.persistReserves(raw, c, patientIds),
      });
    }, config);
  }

  private async persistReserves(
    raw: unknown[],
    c: Counters,
    patientIds: Map<number, string>,
  ): Promise<number> {
    const { valid, invalid } = this.mapper.mapReserves(raw);
    c.failed += invalid.length;
    this.pushErrors(c, toErrorDetails(invalid, "reserves"));
    if (!valid.length) return 0;

    const now = new Date();
    return bulkUpsert({
      table: "reserves",
      columns: [
        { name: "id" },
        { name: "external_key" },
        { name: "patient_id" },
        { name: "patient_external_code" },
        { name: "patient_name_enc" },
        { name: "patient_name" },
        { name: "patient_mobile_enc" },
        { name: "patient_mobile" },
        { name: "reserve_date" },
        { name: "reserve_time" },
        { name: "services_raw" },
        { name: "services_list", cast: "jsonb" },
        { name: "create_date" },
        { name: "create_time" },
        { name: "is_accepted" },
        { name: "doctor_name" },
        { name: "synced_at", cast: "timestamp" },
        { name: "updated_at", cast: "timestamp" },
      ],
      rows: valid.map(({ externalKey, data: d, servicesList }) => [
        newId(),
        externalKey,
        d.patientCode != null ? (patientIds.get(d.patientCode) ?? null) : null,
        d.patientCode,
        d.patientName ? this.encrypt(d.patientName) : null,
        d.patientName,
        d.patientMobile ? this.encrypt(d.patientMobile) : null,
        d.patientMobile,
        d.reserveDate,
        d.reserveTime,
        d.services,
        JSON.stringify(servicesList),
        d.createDate,
        d.createTime,
        d.isAccepted,
        d.doctorName,
        now,
        now,
      ]),
      conflictColumns: ["external_key"],
      updateColumns: [
        "patient_id",
        "patient_external_code",
        "patient_name_enc",
        "patient_name",
        "patient_mobile_enc",
        "patient_mobile",
        "services_raw",
        "services_list",
        "create_date",
        "create_time",
        "is_accepted",
        "doctor_name",
        "synced_at",
        "updated_at",
      ],
    });
  }

  // ─── RECEPTIONS / TREATMENTS: date-windowed ───

  async syncReceptions(trigger: SyncTrigger, config?: SyncConfig): Promise<SyncResult> {
    return this.runSync("RECEPTIONS", trigger, async (onProgress, signal) => {
      const patientIds = await loadPatientIdMap();

      return this.runWindowedSync({
        config,
        signal,
        onProgress,
        windowDays: config?.windowDays ?? DEFAULT_RECEPTION_WINDOW_DAYS,
        // Receptions honour paging inside a window, but return fewer rows than
        // pageSize while more pages remain — only an empty array ends a window.
        paged: true,
        fetch: (window, page, pageSize) =>
          this.api.getReceptions(
            { fromDate: window.from, toDate: window.to, page, pageSize },
            signal,
          ),
        persist: async (raw, c) => {
          const { valid, invalid } = this.mapper.mapReceptions(raw);
          c.failed += invalid.length;
          this.pushErrors(c, toErrorDetails(invalid, "receptions"));
          if (!valid.length) return 0;

          const now = new Date();
          const upserted = await bulkUpsert({
            table: "receptions",
            columns: [
              { name: "id" },
              { name: "external_id" },
              { name: "reception_no" },
              { name: "patient_external_code" },
              { name: "patient_id" },
              { name: "reception_date" },
              { name: "reception_at", cast: "timestamp" },
              { name: "is_return" },
              { name: "description" },
              { name: "treatment_item_names" },
              { name: "treatment_item_names_list", cast: "jsonb" },
              { name: "user_name" },
              { name: "details_json", cast: "jsonb" },
              { name: "total_received", cast: "numeric" },
              { name: "total_discount", cast: "numeric" },
              { name: "total_remain", cast: "numeric" },
              { name: "total_deposit", cast: "numeric" },
              { name: "item_count" },
              { name: "synced_at", cast: "timestamp" },
              { name: "updated_at", cast: "timestamp" },
            ],
            rows: valid.map((v) => [
              newId(),
              v.externalId,
              v.data.receptionNo,
              v.data.patientNo,
              v.data.patientNo != null ? (patientIds.get(v.data.patientNo) ?? null) : null,
              v.data.receptionDate,
              v.receptionAtSql,
              v.data.isReturn,
              v.data.receptionDescription,
              v.data.treatmentItemNames,
              JSON.stringify(v.treatmentItemNamesList),
              v.data.userName,
              JSON.stringify(v.data.receptionDetailDtos),
              v.totals.totalReceived,
              v.totals.totalDiscount,
              v.totals.totalRemain,
              v.totals.totalDeposit,
              v.totals.itemCount,
              now,
              now,
            ]),
            conflictColumns: ["external_id"],
            updateColumns: [
              "reception_no",
              "patient_external_code",
              "patient_id",
              "reception_date",
              "reception_at",
              "is_return",
              "description",
              "treatment_item_names",
              "treatment_item_names_list",
              "user_name",
              "details_json",
              "total_received",
              "total_discount",
              "total_remain",
              "total_deposit",
              "item_count",
              "synced_at",
              "updated_at",
            ],
          });

          await this.replaceReceptionItems(valid);
          return upserted;
        },
      });
    }, config);
  }

  /**
   * Line items are replaced wholesale per reception: the CRM gives its detail
   * rows no stable id, so position is the only key, and a re-sync of an edited
   * reception must not leave orphaned lines behind.
   */
  private async replaceReceptionItems(
    valid: ReturnType<MappingEngine["mapReceptions"]>["valid"],
  ): Promise<void> {
    const externalIds = valid.map((v) => v.externalId);
    if (!externalIds.length) return;

    const parents = await prisma.reception.findMany({
      where: { externalId: { in: externalIds } },
      select: { id: true, externalId: true },
    });
    const parentIds = new Map(parents.map((p) => [p.externalId, p.id]));

    await prisma.receptionItem.deleteMany({
      where: { receptionExternalId: { in: externalIds } },
    });

    const rows: unknown[][] = [];
    for (const v of valid) {
      const receptionId = parentIds.get(v.externalId);
      if (!receptionId) continue;
      for (const item of v.items) {
        rows.push([
          newId(),
          receptionId,
          v.externalId,
          item.lineNo,
          item.sectionId,
          item.serviceExternalId,
          item.sectionName,
          item.serviceName,
          item.personnelName,
          item.receivedPrice,
          item.remainPrice,
          item.discount,
          item.depositPrice,
          v.data.receptionDate,
          v.receptionAtSql,
          v.data.patientNo,
        ]);
      }
    }
    if (!rows.length) return;

    await bulkInsert({
      table: "reception_items",
      columns: [
        { name: "id" },
        { name: "reception_id" },
        { name: "reception_external_id" },
        { name: "line_no" },
        { name: "section_id" },
        { name: "service_external_id" },
        { name: "section_name" },
        { name: "service_name" },
        { name: "personnel_name" },
        { name: "received_price", cast: "numeric" },
        { name: "remain_price", cast: "numeric" },
        { name: "discount", cast: "numeric" },
        { name: "deposit_price", cast: "numeric" },
        { name: "reception_date" },
        { name: "reception_at", cast: "timestamp" },
        { name: "patient_external_code" },
      ],
      rows,
    });
  }

  async syncTreatments(trigger: SyncTrigger, config?: SyncConfig): Promise<SyncResult> {
    return this.runSync("TREATMENTS", trigger, async (onProgress, signal) => {
      const patientIds = await loadPatientIdMap();

      return this.runWindowedSync({
        config,
        signal,
        onProgress,
        windowDays: config?.windowDays ?? DEFAULT_TREATMENT_WINDOW_DAYS,
        // pageNumber/pageSize are ignored outright: page 1 and page 2 of the
        // same range are byte-identical. One request per window, no paging.
        paged: false,
        fetch: (window) =>
          this.api.getTreatments({ fromDate: window.from, toDate: window.to }, signal),
        persist: async (raw, c) => {
          const { valid, invalid } = this.mapper.mapTreatments(raw);
          c.failed += invalid.length;
          this.pushErrors(c, toErrorDetails(invalid, "treatments"));
          if (!valid.length) return 0;

          const now = new Date();
          return bulkUpsert({
            table: "treatments",
            columns: [
              { name: "id" },
              { name: "external_id" },
              { name: "patient_id" },
              { name: "external_patient_code" },
              { name: "plan_date" },
              { name: "plan_name" },
              { name: "plan_user" },
              { name: "reason_name" },
              { name: "reason_names", cast: "jsonb" },
              { name: "details_json", cast: "jsonb" },
              { name: "is_deleted" },
              { name: "synced_at", cast: "timestamp" },
              { name: "updated_at", cast: "timestamp" },
            ],
            rows: valid.map((v) => [
              newId(),
              v.externalId,
              v.data.patientCode != null ? (patientIds.get(v.data.patientCode) ?? null) : null,
              v.data.patientCode,
              v.data.treatmentPlanDate,
              v.data.treatmentPlanName,
              v.data.treatmentPlanUser,
              v.data.treatmentPlanReasonName,
              JSON.stringify(v.reasonNames),
              JSON.stringify(v.data.treatmentPlanDetails),
              v.data.treatmentPlanDeleted,
              now,
              now,
            ]),
            conflictColumns: ["external_id"],
            updateColumns: [
              "patient_id",
              "external_patient_code",
              "plan_date",
              "plan_name",
              "plan_user",
              "reason_name",
              "reason_names",
              "details_json",
              "is_deleted",
              "synced_at",
              "updated_at",
            ],
          });
        },
      });
    }, config);
  }

  // ─── Drivers ───

  private newCounters(config?: SyncConfig): Counters {
    return {
      read: config?.accumulateFrom?.recordsRead ?? 0,
      upserted: config?.accumulateFrom?.recordsUpserted ?? 0,
      failed: config?.accumulateFrom?.recordsFailed ?? 0,
      pages: 0,
      errors: [],
    };
  }

  private pushErrors(c: Counters, errors: SyncErrorDetail[]): void {
    for (const e of errors) {
      if (c.errors.length >= MAX_RETAINED_ERRORS) break;
      c.errors.push(e);
    }
  }

  private progress(c: Counters) {
    return {
      recordsRead: c.read,
      recordsUpserted: c.upserted,
      recordsFailed: c.failed,
      pagesProcessed: c.pages,
    };
  }

  private statusOf(c: Counters): SyncStatus {
    if (c.failed > 0 && c.upserted > 0) return "PARTIAL";
    if (c.failed > 0 && c.upserted === 0) return "FAILED";
    return "SUCCESS";
  }

  /**
   * Offset pagination driver.
   *
   * Terminates ONLY on an empty array. `rows.length < pageSize` is not a valid
   * end-of-data signal for this CRM — Reception returns 40 then 36 rows for
   * pageSize=50 with more pages still to come — and the old engine's use of it
   * is why receptions stopped after page 2 and reported COMPLETED.
   *
   * A repeated page signature aborts loudly: two endpoints ignore paging and
   * replay page 1 forever, which previously ran unbounded to 317,903 pages.
   */
  private async runOffsetSync(opts: {
    config?: SyncConfig;
    signal?: AbortSignal;
    onProgress: (p: ProgressUpdate) => Promise<void>;
    label: string;
    fetch: (page: number, pageSize: number) => Promise<unknown[]>;
    signatureOf: (raw: unknown[]) => string;
    persist: (raw: unknown[], c: Counters) => Promise<number>;
  }) {
    const { config, signal, onProgress, label } = opts;
    const pageSize = config?.pageSize ?? DEFAULT_PAGE_SIZE;
    const startPage = config?.startPage ?? 1;
    const fullSync = config?.fullSync === true;
    const maxPages = fullSync ? MAX_OFFSET_PAGES : (config?.maxPages ?? DEFAULT_MAX_PAGES);
    const throttle = config?.throttleDelayMs ?? DEFAULT_THROTTLE_MS;

    const c = this.newCounters(config);
    c.pages = startPage - 1;

    let previousSignature: string | null = null;
    let reachedEnd = false;

    // Pages are fetched in parallel batches. Measured against this CRM, six
    // concurrent page requests complete in 1.5s versus 8.9s issued serially —
    // the server parallelises well and the old page-at-a-time loop left almost
    // 6x on the table. Results are still *processed* in page order so the
    // stall check and counters stay deterministic.
    const batchSize = Math.max(1, config?.concurrency ?? DEFAULT_CONCURRENCY);

    outer: for (let offset = 0; offset < maxPages; offset += batchSize) {
      if (signal?.aborted) throw new Error("سینک توسط کاربر لغو شد");

      const pages: number[] = [];
      for (let k = 0; k < batchSize && offset + k < maxPages; k++) {
        pages.push(startPage + offset + k);
      }

      const batch = await Promise.all(pages.map((page) => opts.fetch(page, pageSize)));

      for (let k = 0; k < batch.length; k++) {
        const page = pages[k]!;
        const raw = batch[k]!;

        // Offset pagination is monotonic: once a page comes back empty every
        // later page is empty too, so the rest of this batch is discardable.
        if (raw.length === 0) {
          reachedEnd = true;
          break outer;
        }

        const signature = opts.signatureOf(raw);
        if (signature === previousSignature) {
          throw new Error(
            `سرور CRM صفحه‌بندی ${label} را نادیده می‌گیرد: صفحه ${page} دقیقاً همان صفحه قبل است. ` +
              `سینک متوقف شد تا حلقه بی‌پایان رخ ندهد.`,
          );
        }
        previousSignature = signature;

        c.read += raw.length;
        c.upserted += await opts.persist(raw, c);
        c.pages = page;
      }

      await onProgress({ ...this.progress(c), reachedEnd: false, errors: c.errors });
      if (throttle > 0) await delay(throttle, signal);
    }

    await onProgress({ ...this.progress(c), reachedEnd, errors: c.errors });

    return { ...this.progress(c), status: this.statusOf(c), errorDetails: c.errors };
  }

  /**
   * Date-window driver for endpoints that cannot be paged across the whole
   * dataset. Windows run with bounded concurrency but the checkpoint only
   * advances past a fully completed prefix, so a crash re-runs at most one
   * batch rather than skipping a gap.
   */
  private async runWindowedSync(opts: {
    config?: SyncConfig;
    signal?: AbortSignal;
    onProgress: (p: ProgressUpdate) => Promise<void>;
    windowDays: number;
    paged: boolean;
    fetch: (window: JalaliWindow, page: number, pageSize: number) => Promise<unknown[]>;
    persist: (raw: unknown[], c: Counters) => Promise<number>;
  }) {
    const { config, signal, onProgress } = opts;
    const pageSize = config?.pageSize ?? DEFAULT_PAGE_SIZE;
    const throttle = config?.throttleDelayMs ?? DEFAULT_THROTTLE_MS;
    const concurrency = Math.max(1, config?.concurrency ?? DEFAULT_CONCURRENCY);

    const from = config?.startDate ?? config?.historyStart ?? DEFAULT_HISTORY_START;
    const to = config?.endDate ?? jalaliToday();
    const windows = jalaliWindows(from, to, opts.windowDays);

    const c = this.newCounters(config);
    let cursorDate: string | null = config?.startDate ?? null;

    if (!windows.length) {
      await onProgress({ ...this.progress(c), reachedEnd: true, cursorDate, errors: c.errors });
      return { ...this.progress(c), status: this.statusOf(c), errorDetails: c.errors };
    }

    for (let i = 0; i < windows.length; i += concurrency) {
      if (signal?.aborted) throw new Error("سینک توسط کاربر لغو شد");
      const batch = windows.slice(i, i + concurrency);

      // Fetch the batch concurrently; persist sequentially so bulk writes and
      // the counters stay deterministic.
      const fetched = await Promise.all(
        batch.map(async (window) => {
          const pages: unknown[][] = [];
          if (!opts.paged) {
            pages.push(await opts.fetch(window, 1, pageSize));
            return { window, pages };
          }

          // A short page does NOT mean the window is exhausted: with
          // pageSize=1000 this CRM returns 642 rows on page 1 and still has 66
          // on page 2, so only an empty array ends a window. That forces a
          // confirming request per window, which serially costs as much as the
          // data request itself. Fetching pages in speculative pairs overlaps
          // that confirmation with real work instead of paying for it in
          // sequence; the extra request is the one we had to make anyway.
          const LOOKAHEAD = 2;
          for (let page = 1; page <= MAX_OFFSET_PAGES; page += LOOKAHEAD) {
            const speculative = await Promise.all(
              Array.from({ length: LOOKAHEAD }, (_, k) => opts.fetch(window, page + k, pageSize)),
            );
            let exhausted = false;
            for (const raw of speculative) {
              if (raw.length === 0) {
                exhausted = true;
                break;
              }
              pages.push(raw);
            }
            if (exhausted) break;
          }
          return { window, pages };
        }),
      );

      for (const { window, pages } of fetched) {
        for (const raw of pages) {
          if (!raw.length) continue;
          c.read += raw.length;
          c.upserted += await opts.persist(raw, c);
          c.pages += 1;
        }
        cursorDate = window.to;
      }

      await onProgress({
        ...this.progress(c),
        reachedEnd: false,
        cursorDate,
        errors: c.errors,
      });
      if (throttle > 0) await delay(throttle, signal);
    }

    await onProgress({
      ...this.progress(c),
      reachedEnd: true,
      cursorDate,
      errors: c.errors,
    });

    return { ...this.progress(c), status: this.statusOf(c), errorDetails: c.errors };
  }

  // ─── Logging wrapper ───

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
    const log = await prisma.syncLog.create({ data: { entity, status: "STARTED", trigger } });

    let lastCursor: string | null = null;

    const onProgress = async (p: ProgressUpdate) => {
      lastCursor = p.cursorDate ?? lastCursor;
      await prisma.syncLog
        .update({
          where: { id: log.id },
          data: {
            recordsRead: p.recordsRead,
            recordsUpserted: p.recordsUpserted,
            recordsFailed: p.recordsFailed,
            metadata: {
              pagesProcessed: p.pagesProcessed,
              cursorDate: p.cursorDate ?? null,
              errors: p.errors?.slice(0, 50) ?? [],
            } as unknown as Prisma.InputJsonValue,
          },
        })
        .catch(() => {});

      if (config?.onJobState) {
        await config.onJobState({
          ...p,
          entity,
          lastPage: p.pagesProcessed + 1,
          cursorDate: p.cursorDate ?? lastCursor,
        });
      }
    };

    try {
      const result = await fn(onProgress, signal);

      const metadata = {
        pagesProcessed: result.pagesProcessed,
        cursorDate: lastCursor,
        ...(result.errorDetails?.length
          ? { errors: result.errorDetails.slice(0, MAX_RETAINED_ERRORS) }
          : {}),
      } as unknown as Prisma.InputJsonValue;

      const aborted = signal?.aborted === true;
      const status: SyncStatus = aborted ? "PARTIAL" : result.status;

      await prisma.syncLog.update({
        where: { id: log.id },
        data: {
          status,
          recordsRead: result.recordsRead,
          recordsUpserted: result.recordsUpserted,
          recordsFailed: result.recordsFailed,
          errorMessage: aborted ? "سینک توسط کاربر لغو شد" : result.errorMessage,
          metadata,
          finishedAt: new Date(),
        },
      });

      return {
        entity,
        ...result,
        status,
        ...(aborted ? { errorMessage: "سینک توسط کاربر لغو شد" } : {}),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "خطای ناشناخته در سینک";
      const isAborted = signal?.aborted || message.includes("لغو شد");
      const status: SyncStatus = isAborted ? "PARTIAL" : "FAILED";

      await prisma.syncLog
        .update({
          where: { id: log.id },
          data: { status, errorMessage: message, finishedAt: new Date() },
        })
        .catch(() => {});

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
