import { Router } from "express";
import { prisma } from "@jordan/db";
import { DEFAULT_TELEPHONY_SETTINGS, telephonySettingsUpdateSchema } from "@jordan/shared";
import { requirePermission } from "../middleware/permission.middleware.js";

/**
 * Click-to-call configuration.
 *
 * Reading is open to anyone who can work a lead — the dial button on the leads
 * page needs it on every load — while changing it is a system setting.
 */
export const telephonyRouter = Router();

const SINGLETON = { id: 1 } as const;

async function getSettings() {
  const row = await prisma.telephonySettings.findUnique({ where: SINGLETON });
  if (row) {
    const { id: _id, updatedAt: _u, ...settings } = row;
    return settings;
  }
  return DEFAULT_TELEPHONY_SETTINGS;
}

telephonyRouter.get("/", requirePermission("leads"), async (_req, res, next) => {
  try {
    res.json(await getSettings());
  } catch (e) {
    next(e);
  }
});

telephonyRouter.put("/", requirePermission("settings.telephony"), async (req, res, next) => {
  try {
    const update = telephonySettingsUpdateSchema.parse(req.body ?? {});
    // The row is created by the migration, but an upsert keeps this endpoint
    // working on a database restored from a dump that predates it.
    await prisma.telephonySettings.upsert({
      where: SINGLETON,
      create: { ...DEFAULT_TELEPHONY_SETTINGS, ...update, id: 1 },
      update,
    });
    res.json(await getSettings());
  } catch (e) {
    next(e);
  }
});
