import { Router } from "express";
import { prisma } from "@jordan/db";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { createEncryptFn, decrypt } from "../security/encryption.js";
import {
  requirePermission,
  requireAnyPermission,
} from "../middleware/permission.middleware.js";
import { invalidateAllIdentityCache } from "../middleware/auth.middleware.js";
import { AVAILABLE_PERMISSIONS, ALL_PERMISSION_KEYS } from "../lib/permissions.js";

export const adminRouter = Router();
const encrypt = createEncryptFn();

const createUserSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(1),
  password: z.string().min(8).max(128),
  roleId: z.string().min(1),
  isActive: z.boolean().default(true),
});

const updateUserSchema = z.object({
  email: z.string().email().optional(),
  fullName: z.string().min(1).optional(),
  password: z.string().min(8).max(128).optional(),
  roleId: z.string().min(1).nullable().optional(),
  isActive: z.boolean().optional(),
});

/**
 * Only keys the catalogue actually defines may be stored. Without this a typo
 * in the UI silently creates a permission nothing ever checks, which looks
 * granted in role management and denies in practice. `*` stays reserved for the
 * seeded superadmin role and cannot be handed out through the API.
 */
const permissionKeySchema = z
  .array(z.string())
  .refine((keys) => keys.every((k) => ALL_PERMISSION_KEYS.includes(k)), {
    message: "کلید دسترسی ناشناخته است",
  });

const createRoleSchema = z.object({
  name: z.string().min(2).max(50),
  label: z.string().min(1).max(100),
  description: z.string().optional(),
  permissions: permissionKeySchema.default([]),
});

const updateRoleSchema = z.object({
  label: z.string().min(1).max(100).optional(),
  description: z.string().optional(),
  permissions: permissionKeySchema.optional(),
});

// ─── Users ───

adminRouter.get("/users", requirePermission("settings.users"), async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      include: { role: true },
      orderBy: { createdAt: "desc" },
    });

    const safe = users.map((u) => ({
      id: u.id,
      email: u.email,
      fullName: u.fullName,
      role: u.role ? { id: u.role.id, name: u.role.name, label: u.role.label } : null,
      isActive: u.isActive,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
    }));

    res.json(safe);
  } catch (e) {
    next(e);
  }
});

adminRouter.post("/users", requirePermission("settings.users"), async (req, res, next) => {
  try {
    const body = createUserSchema.parse(req.body);

    const existing = await prisma.user.findUnique({ where: { email: body.email } });
    if (existing) {
      res.status(409).json({ error: "این ایمیل قبلاً ثبت شده است" });
      return;
    }

    const password = await bcrypt.hash(body.password, 12);
    const user = await prisma.user.create({
      data: {
        email: body.email,
        fullName: body.fullName,
        password,
        roleId: body.roleId,
        isActive: body.isActive,
      },
      include: { role: true },
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user?.sub,
        action: "ROLE_CHANGE",
        resource: `user:${user.id}`,
        metadata: { action: "create", email: user.email },
      },
    });

    res.status(201).json({
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role ? { id: user.role.id, name: user.role.name, label: user.role.label } : null,
      isActive: user.isActive,
      createdAt: user.createdAt,
    });
  } catch (e) {
    if (e instanceof z.ZodError) {
      res.status(400).json({ error: "اطلاعات وارد شده معتبر نیست", details: e.errors });
      return;
    }
    next(e);
  }
});

adminRouter.patch("/users/:id", requirePermission("settings.users"), async (req, res, next) => {
  try {
    const body = updateUserSchema.parse(req.body);

    if (body.email) {
      const existing = await prisma.user.findFirst({
        where: { email: body.email, id: { not: req.params.id } },
      });
      if (existing) {
        res.status(409).json({ error: "این ایمیل قبلاً ثبت شده است" });
        return;
      }
    }

    const data: Record<string, unknown> = {};
    if (body.email) data.email = body.email;
    if (body.fullName) data.fullName = body.fullName;
    if (body.password) data.password = await bcrypt.hash(body.password, 12);
    if (body.roleId !== undefined) data.roleId = body.roleId;
    if (body.isActive !== undefined) data.isActive = body.isActive;

    const user = await prisma.user.update({
      where: { id: req.params.id },
      data,
      include: { role: true },
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user?.sub,
        action: "ROLE_CHANGE",
        resource: `user:${user.id}`,
        metadata: { action: "update", email: user.email },
      },
    });

    res.json({
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role ? { id: user.role.id, name: user.role.name, label: user.role.label } : null,
      isActive: user.isActive,
    });
  } catch (e) {
    if (e instanceof z.ZodError) {
      res.status(400).json({ error: "اطلاعات وارد شده معتبر نیست", details: e.errors });
      return;
    }
    next(e);
  }
});

adminRouter.delete("/users/:id", requirePermission("settings.users"), async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) {
      res.status(404).json({ error: "کاربر یافت نشد" });
      return;
    }

    if (user.email === "admin@jordanclinic.ir") {
      res.status(403).json({ error: "نمی‌توان کاربر پیش‌فرض سیستم را حذف کرد" });
      return;
    }

    await prisma.user.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

// ─── Roles ───

adminRouter.get("/roles", requireAnyPermission("settings.roles", "settings.users"), async (req, res, next) => {
  try {
    const roles = await prisma.role.findMany({
      include: { _count: { select: { users: true } } },
      orderBy: { createdAt: "desc" },
    });
    res.json(roles);
  } catch (e) {
    next(e);
  }
});

adminRouter.post("/roles", requirePermission("settings.roles"), async (req, res, next) => {
  try {
    const body = createRoleSchema.parse(req.body);

    const existing = await prisma.role.findUnique({ where: { name: body.name } });
    if (existing) {
      res.status(409).json({ error: "این نقش قبلاً ثبت شده است" });
      return;
    }

    const role = await prisma.role.create({ data: body });
    res.status(201).json(role);
  } catch (e) {
    if (e instanceof z.ZodError) {
      res.status(400).json({ error: "اطلاعات وارد شده معتبر نیست", details: e.errors });
      return;
    }
    next(e);
  }
});

adminRouter.patch("/roles/:id", requirePermission("settings.roles"), async (req, res, next) => {
  try {
    const body = updateRoleSchema.parse(req.body);

    /**
     * The superadmin role is not editable through the API.
     *
     * Deleting it was already refused; editing it was not, which left the
     * larger hole of the two. `*` cannot be *granted* here — it is absent from
     * `ALL_PERMISSION_KEYS`, so `permissionKeySchema` rejects it — but it could
     * be *removed*: one PATCH replacing the permission list would strip `*`
     * from the only role that holds it and lock every account out of role
     * management permanently, with no path back through the UI.
     */
    const target = await prisma.role.findUnique({
      where: { id: req.params.id },
      select: { name: true },
    });
    if (target?.name === "superadmin") {
      res.status(403).json({ error: "نقش مدیر سیستم قابل ویرایش نیست" });
      return;
    }

    const role = await prisma.role.update({
      where: { id: req.params.id },
      data: body,
    });
    // Sessions cache the permission list for up to 30s; clearing it here makes
    // an access change take effect on the very next request instead.
    invalidateAllIdentityCache();
    res.json(role);
  } catch (e) {
    if (e instanceof z.ZodError) {
      res.status(400).json({ error: "اطلاعات وارد شده معتبر نیست", details: e.errors });
      return;
    }
    next(e);
  }
});

adminRouter.delete("/roles/:id", requirePermission("settings.roles"), async (req, res, next) => {
  try {
    const userCount = await prisma.user.count({ where: { roleId: req.params.id } });
    if (userCount > 0) {
      res.status(400).json({ error: "این نقش به کاربران اختصاص دارد. ابتدا کاربران را جابجا کنید" });
      return;
    }

    if (req.params.id === (await prisma.role.findFirst({ where: { name: "superadmin" } }))?.id) {
      res.status(403).json({ error: "نقش مدیر سیستم قابل حذف نیست" });
      return;
    }

    await prisma.role.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

// ─── Permissions list ───

export { AVAILABLE_PERMISSIONS };

adminRouter.get("/permissions", requireAnyPermission("settings.roles", "settings.users"), (_req, res) => {
  res.json(AVAILABLE_PERMISSIONS);
});

adminRouter.get("/leads-bank", requirePermission("settings.leads-bank"), async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page ?? 1));
    const limit = Math.min(Math.max(1, Number(req.query.limit ?? 50)), 200);
    const skip = (page - 1) * limit;
    const search = (req.query.search as string)?.trim();

    const where: Record<string, unknown> = {};
    if (search) {
      where.OR = [
        { externalRef: { contains: search } },
        { source: search.toUpperCase() as never },
      ].filter(Boolean);
    }

    const select = {
      id: true,
      source: true,
      status: true,
      fullNameEnc: true,
      mobileEnc: true,
      externalRef: true,
      createdAt: true,
      assignedUser: { select: { id: true, fullName: true } },
    } as const;

    const allLeads = await prisma.lead.findMany({
      where,
      orderBy: { createdAt: "desc" },
      select,
    });

    // Deduplicate by phone: keep the newest entry per phone, merge sources
    const byPhone = new Map<string, typeof allLeads[0] & { sources: string[] }>();
    for (const l of allLeads) {
      let mobile: string | null = null;
      try { mobile = l.mobileEnc ? decrypt(l.mobileEnc) : null; } catch {}
      const key = mobile ? mobile.replace(/\D/g, "").slice(-10) : l.id;
      const existing = byPhone.get(key);
      if (existing) {
        const sources = new Set([...existing.sources, l.source]);
        if (new Date(l.createdAt) > new Date(existing.createdAt)) {
          byPhone.set(key, { ...l, sources: [...sources] });
        } else {
          existing.sources = [...sources];
        }
      } else {
        byPhone.set(key, { ...l, sources: [l.source] });
      }
    }

    const deduped = Array.from(byPhone.values())
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const total = deduped.length;
    const pageLeads = deduped.slice(skip, skip + limit);

    const decrypted = pageLeads.map((l) => {
      let fullName: string | null = null;
      let mobile: string | null = null;
      try { fullName = l.fullNameEnc ? decrypt(l.fullNameEnc) : null; } catch {}
      try { mobile = l.mobileEnc ? decrypt(l.mobileEnc) : null; } catch {}
      return { ...l, fullNameEnc: undefined, mobileEnc: undefined, fullName, mobile, sources: l.sources };
    });

    res.json({
      data: decrypted,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (e) {
    next(e);
  }
});
