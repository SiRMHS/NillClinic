import { Router } from "express";
import { prisma } from "@jordan/db";

export const webhookLogsRouter = Router();

webhookLogsRouter.get("/", async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const offset = Number(req.query.offset) || 0;
    const source = req.query.source as string | undefined;
    const action = req.query.action as string | undefined;

    const where: Record<string, unknown> = {};
    if (source) where.source = source;
    if (action) where.action = action;

    const [logs, total] = await Promise.all([
      prisma.webhookLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.webhookLog.count({ where }),
    ]);

    res.json({ logs, total, limit, offset });
  } catch (e) {
    next(e);
  }
});
