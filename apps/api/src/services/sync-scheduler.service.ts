import { runIncrementalSync, ALL_SYNC_ENTITIES } from "@jordan/sync-engine";
import { prisma } from "@jordan/db";
import type { SyncEntity, SyncStatus } from "@jordan/db";
import { createEncryptFn } from "../security/encryption.js";
import { PatientRankingService } from "./patient-ranking.service.js";
import { getSyncSettings } from "./sync-state.service.js";
import { isAutoSyncRunning } from "./auto-sync.runner.js";

/**
 * Repeating incremental sync — "سینک ساعتی".
 *
 * The full auto-sync loads the CRM once and stops; from then on the dashboard
 * shows a snapshot that quietly ages. This keeps it current by re-reading only
 * the recent slice on a fixed interval stored in the database, so the cadence
 * is an operator setting rather than a redeploy.
 *
 * The tick is deliberately a plain interval rather than a cron expression: the
 * due time lives in `sync_settings.next_run_at`, which means a restart resumes
 * the schedule instead of resetting it, and a run that overruns its slot simply
 * pushes the next one out rather than stacking.
 */

/** How often the process wakes to ask whether a run is due. */
const TICK_MS = 30_000;

export const MIN_INTERVAL_MINUTES = 15;
export const MAX_INTERVAL_MINUTES = 24 * 60;
export const MAX_LOOKBACK_DAYS = 365;

let timer: NodeJS.Timeout | null = null;
let running = false;
let currentAbort: AbortController | null = null;

export function isScheduledSyncRunning(): boolean {
  return running;
}

export interface ScheduleUpdate {
  scheduleEnabled?: boolean;
  intervalMinutes?: number;
  lookbackDays?: number;
  scheduleEntities?: SyncEntity[];
}

function clampInterval(minutes: number): number {
  return Math.min(MAX_INTERVAL_MINUTES, Math.max(MIN_INTERVAL_MINUTES, Math.round(minutes)));
}

export function nextRunFrom(from: Date, intervalMinutes: number): Date {
  return new Date(from.getTime() + clampInterval(intervalMinutes) * 60_000);
}

export async function getSchedule() {
  const s = await getSyncSettings();
  return {
    scheduleEnabled: s.scheduleEnabled,
    intervalMinutes: s.intervalMinutes,
    lookbackDays: s.lookbackDays,
    // An empty list means "everything"; the UI shows it that way too.
    scheduleEntities: s.scheduleEntities.length ? s.scheduleEntities : ALL_SYNC_ENTITIES,
    allEntitiesSelected: s.scheduleEntities.length === 0,
    lastRunAt: s.lastRunAt,
    nextRunAt: s.nextRunAt,
    lastRunStatus: s.lastRunStatus,
    lastRunMessage: s.lastRunMessage,
    lastRunRead: s.lastRunRead,
    lastRunUpserted: s.lastRunUpserted,
    lastRunDurationMs: s.lastRunDurationMs,
    isRunning: running,
  };
}

export async function updateSchedule(input: ScheduleUpdate) {
  const current = await getSyncSettings();

  const intervalMinutes =
    input.intervalMinutes === undefined ? current.intervalMinutes : clampInterval(input.intervalMinutes);
  const scheduleEnabled = input.scheduleEnabled ?? current.scheduleEnabled;
  const lookbackDays =
    input.lookbackDays === undefined
      ? current.lookbackDays
      : Math.min(MAX_LOOKBACK_DAYS, Math.max(0, Math.round(input.lookbackDays)));

  // Turning the schedule on, or changing its cadence, re-bases the due time
  // from now — otherwise a stale `next_run_at` from a long-disabled schedule
  // would fire the moment it is switched back on.
  const rebase =
    scheduleEnabled &&
    (!current.scheduleEnabled || intervalMinutes !== current.intervalMinutes || !current.nextRunAt);

  await prisma.syncSettings.update({
    where: { id: 1 },
    data: {
      scheduleEnabled,
      intervalMinutes,
      lookbackDays,
      ...(input.scheduleEntities !== undefined ? { scheduleEntities: input.scheduleEntities } : {}),
      ...(rebase ? { nextRunAt: nextRunFrom(new Date(), intervalMinutes) } : {}),
      ...(scheduleEnabled ? {} : { nextRunAt: null }),
    },
  });

  return getSchedule();
}

/**
 * Runs one incremental pass now.
 *
 * `reason` distinguishes the scheduler's own tick from an operator pressing
 * "run now", which is worth having in the stored message when a run fails.
 */
export async function runScheduledSyncNow(
  reason: "scheduled" | "manual" = "manual",
): Promise<{ started: boolean; reason?: string }> {
  if (running) return { started: false, reason: "سینک ساعتی هم‌اکنون در حال اجراست" };
  // The full sync saturates the CRM on its own; overlapping the two would slow
  // both and interleave writes to the same tables for no gain.
  if (isAutoSyncRunning()) return { started: false, reason: "سینک کامل در حال اجراست" };

  const settings = await getSyncSettings();
  running = true;
  currentAbort = new AbortController();
  const startedAt = Date.now();

  void (async () => {
    let status: SyncStatus = "SUCCESS";
    let message: string | null = null;
    let read = 0;
    let upserted = 0;

    try {
      const summary = await runIncrementalSync(createEncryptFn(), {
        signal: currentAbort?.signal,
        entities: settings.scheduleEntities.length ? settings.scheduleEntities : undefined,
        lookbackDays: settings.lookbackDays,
        pageSize: settings.pageSize,
        throttleDelayMs: settings.throttleDelayMs,
      });

      let receptionsChanged = 0;
      for (const r of summary.results) {
        read += r.recordsRead;
        upserted += r.recordsUpserted;
        if (r.entity === "RECEPTIONS") receptionsChanged += r.recordsUpserted;
      }

      const failed = summary.results.filter((r) => r.status === "FAILED");
      const partial = summary.results.filter((r) => r.status === "PARTIAL");

      if (failed.length) {
        status = "FAILED";
        message = failed.map((r) => `${r.entity}: ${r.errorMessage ?? "خطا"}`).join(" | ");
      } else if (partial.length || summary.skipped.length) {
        status = "PARTIAL";
        message = [
          ...partial.map((r) => `${r.entity}: ناقص`),
          ...summary.skipped.map((sk) => `${sk.entity}: ${sk.reason}`),
        ].join(" | ");
      } else {
        message = `بازه ${summary.range.from} تا ${summary.range.to}`;
      }

      // RFM scores and value tiers are derived from reception money, so only a
      // reception change can move them. Gating on that specifically matters at
      // this cadence: the recompute walks the whole patient table, and running
      // it every hour because a service name changed would be pure waste.
      if (receptionsChanged > 0 && !currentAbort?.signal.aborted) {
        try {
          await new PatientRankingService().recompute();
        } catch (err) {
          console.error("[scheduled-sync] RFM recompute failed:", err);
        }
      }
    } catch (err) {
      status = currentAbort?.signal.aborted ? "PARTIAL" : "FAILED";
      message = err instanceof Error ? err.message : "خطای سینک ساعتی";
    } finally {
      const finishedAt = new Date();
      running = false;
      currentAbort = null;

      const fresh = await getSyncSettings();
      await prisma.syncSettings
        .update({
          where: { id: 1 },
          data: {
            lastRunAt: finishedAt,
            lastRunStatus: status,
            lastRunMessage: message ? `[${reason}] ${message}`.slice(0, 1000) : null,
            lastRunRead: read,
            lastRunUpserted: upserted,
            lastRunDurationMs: Date.now() - startedAt,
            // Measured from the end of the run, so a pass that takes longer
            // than the interval never queues a second one behind itself.
            nextRunAt: fresh.scheduleEnabled
              ? nextRunFrom(finishedAt, fresh.intervalMinutes)
              : null,
          },
        })
        .catch((err) => console.error("[scheduled-sync] could not record run:", err));

      console.info(
        `[scheduled-sync] ${reason} run finished: ${status}, ${read} read / ${upserted} upserted in ${
          Date.now() - startedAt
        }ms`,
      );
    }
  })();

  return { started: true };
}

export function abortScheduledSync(): boolean {
  if (!currentAbort) return false;
  currentAbort.abort();
  return true;
}

async function tick(): Promise<void> {
  if (running) return;
  try {
    const settings = await getSyncSettings();
    if (!settings.scheduleEnabled) return;

    // A missing due time means the schedule was enabled without one; set it so
    // the next tick has something to compare against.
    if (!settings.nextRunAt) {
      await prisma.syncSettings.update({
        where: { id: 1 },
        data: { nextRunAt: nextRunFrom(new Date(), settings.intervalMinutes) },
      });
      return;
    }

    if (settings.nextRunAt.getTime() > Date.now()) return;
    if (isAutoSyncRunning()) return; // Try again on the next tick.

    await runScheduledSyncNow("scheduled");
  } catch (err) {
    console.error("[scheduled-sync] tick failed:", err);
  }
}

/** Starts the ticker. Safe to call once, on API startup. */
export function startSyncScheduler(): void {
  if (timer) return;
  timer = setInterval(() => void tick(), TICK_MS);
  timer.unref?.();
  console.info(`[scheduled-sync] scheduler started (tick every ${TICK_MS / 1000}s)`);
}

export function stopSyncScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
