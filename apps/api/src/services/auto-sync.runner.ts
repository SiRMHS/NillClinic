import { runAutoSync, ALL_SYNC_ENTITIES } from "@jordan/sync-engine";
import type { SyncEntity } from "@jordan/db";
import { prisma } from "@jordan/db";
import { createEncryptFn } from "../security/encryption.js";
import {
  cleanupStaleJobStates,
  getSyncSettings,
  setAutoSyncEnabled,
} from "./sync-state.service.js";

let currentAbortController: AbortController | null = null;
let backgroundPromise: Promise<void> | null = null;

export function isAutoSyncRunning(): boolean {
  return currentAbortController !== null;
}

export function getRunningEntities(): SyncEntity[] {
  if (!currentAbortController) return [];
  return currentEntities;
}

let currentEntities: SyncEntity[] = [];

export async function startAutoSync(opts?: { entities?: SyncEntity[]; resume?: boolean }): Promise<{ started: boolean; reason?: string }> {
  if (currentAbortController) {
    return { started: false, reason: "سینک خودکار از قبل در حال اجراست" };
  }

  const settings = await getSyncSettings();
  const entities = opts?.entities ?? (await pendingEntities());

  if (entities.length === 0) {
    if (!opts?.resume) await setAutoSyncEnabled(false);
    return { started: false, reason: "همه بخش‌ها تکمیل شده‌اند" };
  }

  currentEntities = entities;
  currentAbortController = new AbortController();
  const controller = currentAbortController;

  backgroundPromise = runAutoSync(createEncryptFn(), {
    signal: controller.signal,
    entities,
    throttleDelayMs: settings.throttleDelayMs,
    pageSize: settings.pageSize,
  })
    .catch(async (err) => {
      if (!controller.signal.aborted) {
        // eslint-disable-next-line no-console
        console.error("[auto-sync] error:", err);
      }
    })
    .finally(async () => {
      if (currentAbortController === controller) {
        currentAbortController = null;
        backgroundPromise = null;
        currentEntities = [];
      }
      // If the switch is still on and there's more to do, loop again.
      const s = await getSyncSettings();
      if (s.autoSyncEnabled && !controller.signal.aborted) {
        const pending = await pendingEntities();
        if (pending.length > 0) {
          void startAutoSync({ resume: true });
        }
      }
    });

  return { started: true };
}

export async function stopAutoSync(): Promise<{ finalized: number }> {
  if (currentAbortController) {
    currentAbortController.abort();
  }
  currentAbortController = null;
  currentEntities = [];
  if (backgroundPromise) {
    void backgroundPromise.catch(() => {});
    backgroundPromise = null;
  }
  await setAutoSyncEnabled(false);
  return { finalized: 0 };
}

/** Entities that are not yet fully synced (reachedEnd = false). */
export async function pendingEntities(): Promise<SyncEntity[]> {
  const jobs = await prisma.syncJobState.findMany();
  const reached = new Set(jobs.filter((j) => j.reachedEnd).map((j) => j.entity));
  return ALL_SYNC_ENTITIES.filter((e) => !reached.has(e));
}

/** Called on API startup: if the switch is on, resume the auto-sync. */
export async function resumeAutoSyncOnStartup(): Promise<void> {
  await cleanupStaleJobStates();
  const settings = await getSyncSettings();
  if (settings.autoSyncEnabled) {
    const pending = await pendingEntities();
    if (pending.length > 0) {
      // eslint-disable-next-line no-console
      console.info(`[auto-sync] resuming after startup — ${pending.length} entity/entities pending`);
      void startAutoSync({ resume: true });
    } else {
      // eslint-disable-next-line no-console
      console.info("[auto-sync] switch on but nothing pending");
    }
  }
}
