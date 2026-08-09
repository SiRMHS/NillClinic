import { Router } from "express";
import { prisma } from "@jordan/db";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { createEncryptFn, decrypt } from "../security/encryption.js";

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

const createRoleSchema = z.object({
  name: z.string().min(2).max(50),
  label: z.string().min(1).max(100),
  description: z.string().optional(),
  permissions: z.array(z.string()).default([]),
});

const updateRoleSchema = z.object({
  label: z.string().min(1).max(100).optional(),
  description: z.string().optional(),
  permissions: z.array(z.string()).optional(),
});

// ─── Users ───

adminRouter.get("/users", async (req, res, next) => {
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

adminRouter.post("/users", async (req, res, next) => {
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

adminRouter.patch("/users/:id", async (req, res, next) => {
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

adminRouter.delete("/users/:id", async (req, res, next) => {
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

adminRouter.get("/roles", async (req, res, next) => {
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

adminRouter.post("/roles", async (req, res, next) => {
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

adminRouter.patch("/roles/:id", async (req, res, next) => {
  try {
    const body = updateRoleSchema.parse(req.body);
    const role = await prisma.role.update({
      where: { id: req.params.id },
      data: body,
    });
    res.json(role);
  } catch (e) {
    if (e instanceof z.ZodError) {
      res.status(400).json({ error: "اطلاعات وارد شده معتبر نیست", details: e.errors });
      return;
    }
    next(e);
  }
});

adminRouter.delete("/roles/:id", async (req, res, next) => {
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

export const AVAILABLE_PERMISSIONS = [
  { key: "dashboard", label: "داشبورد", group: "اصلی" },
  { key: "patients", label: "بیماران (مدیریت)", group: "بیماران" },
  { key: "patients.view", label: "بیماران (مشاهده)", group: "بیماران" },
  { key: "leads", label: "لیدها", group: "فروش" },
  { key: "crm", label: "CRM (تحلیل مراجعین)", group: "گزارشات" },
  { key: "analytics", label: "تحلیل‌ها", group: "گزارشات" },
  { key: "settings", label: "تنظیمات", group: "سیستم" },
  { key: "settings.users", label: "مدیریت کاربران", group: "سیستم" },
  { key: "settings.roles", label: "مدیریت نقش‌ها", group: "سیستم" },
  { key: "settings.webhook-logs", label: "لاگ وب‌هوک", group: "سیستم" },
  { key: "settings.external-migration", label: "ورودی خارجی", group: "سیستم" },
  { key: "settings.leads-log", label: "لاگ ورودی‌ها", group: "سیستم" },
  { key: "settings.leads-bank", label: "بانک لیدها", group: "سیستم" },
] as const;

adminRouter.get("/permissions", (_req, res) => {
  res.json(AVAILABLE_PERMISSIONS);
});

adminRouter.get("/leads-bank", async (req, res, next) => {
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
