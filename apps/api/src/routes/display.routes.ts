import { Router } from "express";
import { prisma } from "@jordan/db";
import { DEFAULT_DISPLAY_SETTINGS, displaySettingsUpdateSchema } from "@jordan/shared";
import { requirePermission } from "../middleware/permission.middleware.js";
import { getDisplaySettings, invalidateDisplaySettings } from "../lib/display-settings.js";

/**
 * Which figures the dashboard renders at all.
 *
 * Reading is open to any signed-in user: every page needs to know whether to
 * paint amounts before it paints anything, and the answer carries no data of
 * its own — it is three booleans. Changing it is a system setting.
 */
export const displayRouter = Router();

const SINGLETON = { id: 1 } as const;

displayRouter.get("/", async (_req, res, next) => {
  try {
    res.json(await getDisplaySettings());
  } catch (e) {
    next(e);
  }
});

displayRouter.put("/", requirePermission("settings.display"), async (req, res, next) => {
  try {
    const update = displaySettingsUpdateSchema.parse(req.body ?? {});
    // The row is created by the migration; the upsert keeps this working on a
    // database restored from a dump that predates it.
    await prisma.displaySettings.upsert({
      where: SINGLETON,
      create: { ...DEFAULT_DISPLAY_SETTINGS, ...update, id: 1 },
      update,
    });
    invalidateDisplaySettings();
    res.json(await getDisplaySettings());
  } catch (e) {
    next(e);
  }
});
