import { prisma } from "@jordan/db";
import type { SyncEntity } from "@jordan/db";

const STALE_SYNC_MS = 15 * 60 * 1000;

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
