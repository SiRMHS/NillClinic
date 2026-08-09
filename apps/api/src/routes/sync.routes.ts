import { Router } from "express";
import { z } from "zod";
import { runManualSync, purgeCrmData, ALL_SYNC_ENTITIES } from "@jordan/sync-engine";
import type { SyncConfig } from "@jordan/sync-engine";
import { prisma, SyncEntity, AuditAction } from "@jordan/db";
import { createEncryptFn } from "../security/encryption.js";
import {
  cleanupStaleSyncLogs,
  finalizeRunningSyncLogs,
  getRunningSyncEntities,
  getAllJobStates,
  getSyncSettings,
  setAutoSyncEnabled,
  updateSyncSettings,
  resetJobState,
  resetAllJobStates,
} from "../services/sync-state.service.js";
import {
  startAutoSync,
  stopAutoSync,
  isAutoSyncRunning,
  resumeAutoSyncOnStartup,
} from "../services/auto-sync.runner.js";

export { resumeAutoSyncOnStartup };

export const syncRouter = Router();

const syncConfigSchema = z.object({
  maxPages: z.coerce.number().int().min(1).max(100).default(2),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  entities: z
    .array(z.nativeEnum(SyncEntity))
    .optional(),
});

const autoSettingsSchema = z.object({
  throttleDelayMs: z.coerce.number().int().min(0).max(30_000),
  pageSize: z.coerce.number().int().min(1).max(200),
});

let currentAbortController: AbortController | null = null;
let backgroundSyncPromise: Promise<void> | null = null;

function isBackgroundSyncActive(): boolean {
  return currentAbortController !== null;
}

async function runSyncInBackground(
  config: SyncConfig,
  userEmail?: string,
): Promise<void> {
  const encrypt = createEncryptFn();
  try {
    const results = await runManualSync(encrypt, config);

    if (userEmail) {
      const user = await prisma.user.findUnique({ where: { email: userEmail } });
      if (user) {
        await prisma.auditLog.create({
          data: {
            userId: user.id,
            action: AuditAction.SYNC_MANUAL,
            metadata: JSON.parse(JSON.stringify({ results, config })),
          },
        });
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "خطای سینک";
    if (!config.signal?.aborted) {
      await finalizeRunningSyncLogs(message);
    }
    throw err;
  }
}

syncRouter.get("/status", async (_req, res, next) => {
  try {
    const staleCleaned = await cleanupStaleSyncLogs();
    const runningEntities = await getRunningSyncEntities();
    res.json({
      isRunning: isBackgroundSyncActive() || runningEntities.length > 0,
      runningEntities,
      hasActiveController: isBackgroundSyncActive(),
      staleCleaned,
    });
  } catch (e) {
    next(e);
  }
});

syncRouter.get("/auto", async (_req, res, next) => {
  try {
    const [settings, jobStates] = await Promise.all([getSyncSettings(), getAllJobStates()]);
    res.json({
      autoSyncEnabled: settings.autoSyncEnabled,
      throttleDelayMs: settings.throttleDelayMs,
      pageSize: settings.pageSize,
      isRunning: isAutoSyncRunning(),
      jobStates: jobStates.map((j) => ({
        entity: j.entity,
        status: j.status,
        lastPage: j.lastPage,
        recordsRead: j.recordsRead,
        recordsUpserted: j.recordsUpserted,
        recordsFailed: j.recordsFailed,
        reachedEnd: j.reachedEnd,
        startedAt: j.startedAt,
        finishedAt: j.finishedAt,
        errorMessage: j.errorMessage,
        updatedAt: j.updatedAt,
      })),
    });
  } catch (e) {
    next(e);
  }
});

syncRouter.post("/auto", async (req, res, next) => {
  try {
    const body = z.object({ enabled: z.boolean() }).parse(req.body);
    if (body.enabled) {
      await setAutoSyncEnabled(true);
      const result = await startAutoSync();
      if (!result.started) {
        await setAutoSyncEnabled(false);
        res.status(409).json({ error: result.reason ?? "سینک شروع نشد" });
        return;
      }
    } else {
      await stopAutoSync();
    }

    if (req.user?.email) {
      const user = await prisma.user.findUnique({ where: { email: req.user.email } });
      if (user) {
        await prisma.auditLog.create({
          data: {
            userId: user.id,
            action: AuditAction.SYNC_MANUAL,
            metadata: { action: "auto_sync_toggle", enabled: body.enabled },
          },
        });
      }
    }

    const updated = await getSyncSettings();
    res.json({ ok: true, autoSyncEnabled: updated.autoSyncEnabled, isRunning: isAutoSyncRunning() });
  } catch (e) {
    next(e);
  }
});

syncRouter.patch("/auto/settings", async (req, res, next) => {
  try {
    if (isAutoSyncRunning()) {
      res.status(409).json({ error: "برای تغییر تنظیمات ابتدا سینک خودکار را مکث کنید" });
      return;
    }

    const input = autoSettingsSchema.parse(req.body);
    const settings = await updateSyncSettings(input);
    res.json({
      ok: true,
      throttleDelayMs: settings.throttleDelayMs,
      pageSize: settings.pageSize,
    });
  } catch (e) {
    next(e);
  }
});

syncRouter.post("/auto/reset", async (req, res, next) => {
  try {
    if (isAutoSyncRunning()) {
      res.status(409).json({ error: "ابتدا سینک خودکار را خاموش کنید" });
      return;
    }
    const entity = req.body?.entity as string | undefined;
    if (entity) {
      const parsed = z.nativeEnum(SyncEntity).parse(entity);
      await resetJobState(parsed);
    } else {
      await resetAllJobStates();
    }
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

syncRouter.post("/cancel", async (_req, res, next) => {
  try {
    if (currentAbortController) {
      currentAbortController.abort();
    }
    await stopAutoSync();

    const finalized = await finalizeRunningSyncLogs("سینک توسط کاربر لغو شد");

    currentAbortController = null;

    if (backgroundSyncPromise) {
      void backgroundSyncPromise.catch(() => {});
      backgroundSyncPromise = null;
    }

    res.json({ ok: true, finalized });
  } catch (e) {
    next(e);
  }
});

syncRouter.post("/purge", async (req, res, next) => {
  try {
    if (isBackgroundSyncActive() || isAutoSyncRunning()) {
      res.status(409).json({ error: "ابتدا سینک در حال اجرا را متوقف کنید" });
      return;
    }

    const counts = await purgeCrmData();

    if (req.user?.email) {
      const user = await prisma.user.findUnique({ where: { email: req.user.email } });
      if (user) {
        await prisma.auditLog.create({
          data: {
            userId: user.id,
            action: AuditAction.SYNC_MANUAL,
            metadata: { action: "purge_crm_data", counts },
          },
        });
      }
    }

    res.json({ ok: true, counts });
  } catch (e) {
    next(e);
  }
});

syncRouter.post("/run", async (req, res, next) => {
  try {
    if (isBackgroundSyncActive() || isAutoSyncRunning()) {
      res.status(409).json({ error: "سینک دیگری در حال اجراست" });
      return;
    }

    const running = await getRunningSyncEntities();
    if (running.length > 0) {
      await finalizeRunningSyncLogs("جایگزین با سینک جدید");
    }

    const config: SyncConfig = syncConfigSchema.parse(req.query);
    if (req.body?.entities) {
      config.entities = z.array(z.nativeEnum(SyncEntity)).parse(req.body.entities);
    }

    currentAbortController = new AbortController();
    config.signal = currentAbortController.signal;

    const userEmail = req.user?.email;

    backgroundSyncPromise = runSyncInBackground(config, userEmail).finally(() => {
      currentAbortController = null;
      backgroundSyncPromise = null;
    });

    res.status(202).json({ ok: true, started: true, entities: config.entities });
  } catch (e) {
    currentAbortController = null;
    backgroundSyncPromise = null;
    next(e);
  }
});

syncRouter.post("/run/:entity", async (req, res, next) => {
  try {
    if (isBackgroundSyncActive() || isAutoSyncRunning()) {
      res.status(409).json({ error: "سینک دیگری در حال اجراست" });
      return;
    }

    const entity = z.nativeEnum(SyncEntity).parse(req.params.entity);
    const config: SyncConfig = syncConfigSchema.parse(req.query);
    config.entities = [entity];

    currentAbortController = new AbortController();
    config.signal = currentAbortController.signal;

    const userEmail = req.user?.email;

    backgroundSyncPromise = runSyncInBackground(config, userEmail).finally(() => {
      currentAbortController = null;
      backgroundSyncPromise = null;
    });

    res.status(202).json({ ok: true, started: true, entities: [entity] });
  } catch (e) {
    currentAbortController = null;
    backgroundSyncPromise = null;
    next(e);
  }
});

syncRouter.get("/logs/:id/errors", async (req, res, next) => {
  try {
    const perm = req.user?.permissions ?? [];
    if (!perm.includes("*")) {
      res.status(403).json({ error: "فقط مدیر سیستم می‌تواند جزئیات خطا را مشاهده کند" });
      return;
    }

    const log = await prisma.syncLog.findUnique({ where: { id: req.params.id } });
    if (!log) {
      res.status(404).json({ error: "لاگ یافت نشد" });
      return;
    }

    const errors = (log.metadata as { errors?: { recordId: string; message: string }[] })?.errors ?? [];
    const page = Math.max(1, Number(req.query.page ?? 1));
    const limit = Math.min(Math.max(1, Number(req.query.limit ?? 20)), 100);
    const total = errors.length;
    const totalPages = Math.ceil(total / limit);
    const items = errors.slice((page - 1) * limit, page * limit);

    res.json({ items, total, page, totalPages, limit });
  } catch (e) {
    next(e);
  }
});

syncRouter.get("/logs", async (req, res, next) => {
  try {
    await cleanupStaleSyncLogs();

    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const entity = req.query.entity as string | undefined;

    const where = entity ? { entity: entity as SyncEntity } : {};

    const logs = await prisma.syncLog.findMany({
      where,
      orderBy: { startedAt: "desc" },
      take: limit,
    });
    res.json(logs);
  } catch (e) {
    next(e);
  }
});
