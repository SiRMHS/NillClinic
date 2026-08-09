import { prisma } from "@jordan/db";
import type { SyncEntity, SyncJobStatus } from "@jordan/db";
import { ALL_SYNC_ENTITIES } from "@jordan/sync-engine";

const STALE_SYNC_MS = 15 * 60 * 1000;
const STALE_JOB_MS = 15 * 60 * 1000;

export async function cleanupStaleSyncLogs(maxAgeMs = STALE_SYNC_MS): Promise<number> {
  const cutoff = new Date(Date.now() - maxAgeMs);
  const result = await prisma.syncLog.updateMany({
    where: {
      status: "STARTED",
      startedAt: { lt: cutoff },
    },
    data: {
      status: "PARTIAL",
      errorMessage: "سینک متوقف شد (زمان‌دار یا قطع ارتباط)",
      finishedAt: new Date(),
    },
  });
  return result.count;
}

export async function finalizeRunningSyncLogs(reason: string): Promise<number> {
  const result = await prisma.syncLog.updateMany({
    where: { status: "STARTED" },
    data: {
      status: "PARTIAL",
      errorMessage: reason,
      finishedAt: new Date(),
    },
  });
  return result.count;
}

export async function getRunningSyncEntities(): Promise<SyncEntity[]> {
  await cleanupStaleSyncLogs();
  const logs = await prisma.syncLog.findMany({
    where: { status: "STARTED" },
    select: { entity: true },
    orderBy: { startedAt: "desc" },
  });
  return [...new Set(logs.map((l) => l.entity))];
}

export async function getSyncSettings() {
  return prisma.syncSettings.upsert({
    where: { id: 1 },
    create: { id: 1 },
    update: {},
  });
}

export async function setAutoSyncEnabled(enabled: boolean) {
  return prisma.syncSettings.update({
    where: { id: 1 },
    data: { autoSyncEnabled: enabled },
  });
}

export async function updateSyncSettings(input: { throttleDelayMs: number; pageSize: number }) {
  return prisma.syncSettings.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      throttleDelayMs: input.throttleDelayMs,
      pageSize: input.pageSize,
    },
    update: {
      throttleDelayMs: input.throttleDelayMs,
      pageSize: input.pageSize,
    },
  });
}

export async function getAllJobStates() {
  const existing = await prisma.syncJobState.findMany();
  const map = new Map(existing.map((j) => [j.entity, j]));
  for (const entity of ALL_SYNC_ENTITIES) {
    if (!map.has(entity)) {
      const created = await prisma.syncJobState.upsert({
        where: { entity },
        create: { entity },
        update: {},
      });
      map.set(entity, created);
    }
  }
  return ALL_SYNC_ENTITIES.map((entity) => map.get(entity)!);
}

export async function getJobState(entity: SyncEntity) {
  return prisma.syncJobState.upsert({
    where: { entity },
    create: { entity },
    update: {},
  });
}

/** Mark stale RUNNING jobs as PARTIAL (e.g. after an unclean restart). */
export async function cleanupStaleJobStates(maxAgeMs = STALE_JOB_MS): Promise<number> {
  const cutoff = new Date(Date.now() - maxAgeMs);
  const result = await prisma.syncJobState.updateMany({
    where: {
      status: "RUNNING",
      updatedAt: { lt: cutoff },
    },
    data: {
      status: "PARTIAL",
      errorMessage: "سینک خودکار متوقف شد (ری‌استارت یا قطع ارتباط)",
      finishedAt: new Date(),
    },
  });
  return result.count;
}

export async function resetJobState(entity: SyncEntity) {
  return prisma.syncJobState.update({
    where: { entity },
    data: {
      status: "IDLE",
      lastPage: 1,
      recordsRead: 0,
      recordsUpserted: 0,
      recordsFailed: 0,
      reachedEnd: false,
      startedAt: null,
      finishedAt: null,
      errorMessage: null,
    },
  });
}

export async function resetAllJobStates() {
  await prisma.syncJobState.updateMany({
    where: {},
    data: {
      status: "IDLE",
      lastPage: 1,
      recordsRead: 0,
      recordsUpserted: 0,
      recordsFailed: 0,
      reachedEnd: false,
      startedAt: null,
      finishedAt: null,
      errorMessage: null,
    },
  });
}

export function isJobConsideredRunning(status: SyncJobStatus): boolean {
  return status === "RUNNING";
}
