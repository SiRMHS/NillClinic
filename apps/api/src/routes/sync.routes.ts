import { Router } from "express";
import { z } from "zod";
import { runManualSync } from "@jordan/sync-engine";
import type { SyncConfig, SyncResult } from "@jordan/sync-engine";
import { prisma, SyncEntity, AuditAction } from "@jordan/db";
import { createEncryptFn } from "../security/encryption.js";

export const syncRouter = Router();

const syncConfigSchema = z.object({
  maxPages: z.coerce.number().int().min(1).max(100).default(2),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  entities: z
    .array(z.nativeEnum(SyncEntity))
    .optional(),
});

let currentAbortController: AbortController | null = null;

syncRouter.post("/cancel", async (_req, res) => {
  if (currentAbortController) {
    currentAbortController.abort();
    currentAbortController = null;
  }
  res.json({ ok: true });
});

syncRouter.post("/run", async (req, res, next) => {
  try {
    const config: SyncConfig = syncConfigSchema.parse(req.query);
    if (req.body?.entities) {
      config.entities = z.array(z.nativeEnum(SyncEntity)).parse(req.body.entities);
    }

    currentAbortController = new AbortController();
    config.signal = currentAbortController.signal;

    const results = await runManualSync(createEncryptFn(), config);
    currentAbortController = null;

    if (req.user?.email) {
      const user = await prisma.user.findUnique({ where: { email: req.user.email } });
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

    res.json({ ok: true, results });
  } catch (e) {
    currentAbortController = null;
    next(e);
  }
});

syncRouter.post("/run/:entity", async (req, res, next) => {
  try {
    const entity = z.nativeEnum(SyncEntity).parse(req.params.entity);
    const config: SyncConfig = syncConfigSchema.parse(req.query);

    currentAbortController = new AbortController();
    config.signal = currentAbortController.signal;

    const encrypt = createEncryptFn();
    const result = await runManualSync(encrypt, { ...config, entities: [entity] });
    currentAbortController = null;

    res.json({ ok: true, result: result[0] });
  } catch (e) {
    currentAbortController = null;
    next(e);
  }
});

syncRouter.get("/logs", async (req, res, next) => {
  try {
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
