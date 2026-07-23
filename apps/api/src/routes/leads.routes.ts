import { Router } from "express";
import { prisma, type Prisma } from "@jordan/db";
import {
  assignLeadCampaignSchema,
  assignLeadSchema,
  createFollowUpSchema,
  createLeadSchema,
  leadWebhookSchema,
  registerCallSchema,
  updateLeadStatusSchema,
} from "@jordan/shared";
import { createEncryptFn, decrypt } from "../security/encryption.js";
import { ZodError } from "zod";

export const leadsRouter = Router();
const encrypt = createEncryptFn();

const sourceMap = {
  instagram: "INSTAGRAM" as const,
  whatsapp: "WHATSAPP" as const,
  site: "SITE" as const,
};

const leadInclude = {
  interactions: { orderBy: { createdAt: "desc" as const }, take: 10, include: { user: { select: { id: true, fullName: true } } } },
  calls: { orderBy: { createdAt: "desc" as const }, take: 5, include: { user: { select: { id: true, fullName: true } } } },
  followUps: { orderBy: { scheduledAt: "asc" as const }, take: 5, include: { user: { select: { id: true, fullName: true } } } },
  appointments: { orderBy: { createdAt: "desc" as const }, take: 3, include: { user: { select: { id: true, fullName: true } } } },
  assignedUser: { select: { id: true, fullName: true, email: true } },
  campaign: { select: { id: true, name: true, slug: true } },
};

function isSuperAdmin(req: { user?: { permissions?: string[] } }): boolean {
  return req.user?.permissions?.includes("*") === true;
}

function canModifyLead(lead: { assignedUserId?: string | null }, userId: string | undefined, req: { user?: { permissions?: string[] } }): boolean {
  if (isSuperAdmin(req)) return true;
  if (!lead.assignedUserId) return true;
  return lead.assignedUserId === userId;
}

function decryptLead<T extends { fullNameEnc?: string | null; mobileEnc?: string | null }>(l: T) {
  let fullName: string | null = null;
  let mobile: string | null = null;
  try {
    fullName = l.fullNameEnc ? decrypt(l.fullNameEnc) : null;
    mobile = l.mobileEnc ? decrypt(l.mobileEnc) : null;
  } catch {}
  const { fullNameEnc: _fn, mobileEnc: _mn, ...rest } = l;
  return { ...rest, fullName, mobile };
}

leadsRouter.get("/agents", async (_req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      where: { isActive: true },
      include: {
        role: true,
        _count: {
          select: {
            assignedLeads: { where: { status: { in: ["NEW", "CONTACTED"] } } },
          },
        },
      },
      orderBy: { fullName: "asc" },
    });

    const agents = users
      .filter((u) => u.role?.permissions.includes("leads") || u.role?.permissions.includes("*"))
      .map((u) => ({
        id: u.id,
        fullName: u.fullName,
        email: u.email,
        roleLabel: u.role?.label ?? u.role?.name,
        activeLeads: u._count.assignedLeads,
      }));

    res.json(agents);
  } catch (e) {
    next(e);
  }
});

leadsRouter.get("/", async (req, res, next) => {
  try {
    const status = req.query.status as string | undefined;
    const source = req.query.source as string | undefined;
    const followUp = req.query.followUp as string | undefined;
    const hasAppointment = req.query.hasAppointment as string | undefined;
    const assignedUserId = req.query.assignedUserId as string | undefined;
    const campaignId = req.query.campaignId as string | undefined;
    const sourceStr = Array.isArray(source) ? (source as string[]).join(",") : source as string;
    const sourceList = sourceStr ? sourceStr.split(",").filter(Boolean) as ("INSTAGRAM" | "WHATSAPP" | "SITE" | "MANUAL")[] : undefined;

    const where: Record<string, unknown> = {};
    if (status) where.status = status as "NEW" | "CONTACTED" | "CONVERTED" | "LOST";
    if (sourceList) where.source = { in: sourceList };
    if (assignedUserId) where.assignedUserId = assignedUserId;
    if (campaignId) where.campaignId = campaignId;

    if (followUp === "due") {
      where.nextFollowUpAt = { lte: new Date() };
      where.status = { in: ["NEW", "CONTACTED"] };
    } else if (followUp === "pending") {
      where.nextFollowUpAt = { not: null };
      where.status = { in: ["NEW", "CONTACTED"] };
    }

    if (hasAppointment === "true") {
      where.appointments = { some: {} };
    }

    const orderBy = followUp === "due"
      ? [{ nextFollowUpAt: "asc" as const }, { createdAt: "desc" as const }]
      : { createdAt: "desc" as const };

    const leads = await prisma.lead.findMany({
      where,
      orderBy,
      take: 100,
      include: leadInclude,
    });

    res.json(leads.map(decryptLead));
  } catch (e) {
    next(e);
  }
});

leadsRouter.get("/counts", async (req, res, next) => {
  try {
    const userId = req.user?.sub;
    const whereNewUnassigned: Prisma.LeadWhereInput = { status: "NEW", assignedUserId: null };
    const whereMyActive: Prisma.LeadWhereInput = { assignedUserId: userId ?? undefined, status: { in: ["NEW", "CONTACTED"] } };
    const whereMyOverdue: Prisma.LeadWhereInput = {
      assignedUserId: userId ?? undefined,
      nextFollowUpAt: { lte: new Date() },
      status: { in: ["NEW", "CONTACTED"] },
    };

    const [newUnassigned, myActive, myOverdueFollowUps] = await Promise.all([
      prisma.lead.count({ where: whereNewUnassigned }),
      prisma.lead.count({ where: whereMyActive }),
      prisma.lead.count({ where: whereMyOverdue }),
    ]);

    res.json({ newUnassigned, myActive, myOverdueFollowUps });
  } catch (e) {
    next(e);
  }
});

leadsRouter.get("/:id", async (req, res, next) => {
  try {
    const lead = await prisma.lead.findUnique({
      where: { id: req.params.id },
      include: {
        interactions: { orderBy: { createdAt: "desc" } },
        calls: { orderBy: { createdAt: "desc" }, include: { user: { select: { id: true, fullName: true } } } },
        followUps: { orderBy: { scheduledAt: "asc" }, include: { user: { select: { id: true, fullName: true } } } },
        appointments: { orderBy: { createdAt: "desc" }, include: { user: { select: { id: true, fullName: true } } } },
        assignedUser: { select: { id: true, fullName: true, email: true } },
        campaign: { select: { id: true, name: true, slug: true } },
      },
    });
    if (!lead) {
      res.status(404).json({ error: "لید یافت نشد" });
      return;
    }
    res.json(decryptLead(lead));
  } catch (e) {
    next(e);
  }
});

leadsRouter.post("/", async (req, res, next) => {
  try {
    const body = createLeadSchema.parse(req.body);

    if (body.mobile) {
      const encrypted = encrypt(body.mobile);
      const existing = await prisma.lead.findFirst({
        where: { mobileEnc: encrypted },
        select: { id: true, fullNameEnc: true, mobileEnc: true, source: true, status: true, createdAt: true, metadata: true },
      });
      if (existing) {
        const decrypt = (await import("../security/encryption.js")).decrypt;
        let existingName: string | null = null;
        try { existingName = existing.fullNameEnc ? decrypt(existing.fullNameEnc) : null; } catch {}

        const updated = await prisma.lead.update({
          where: { id: existing.id },
          data: {
            metadata: { ...(existing.metadata as Record<string, unknown>), ...(body.metadata as Record<string, unknown>), recreatedAt: new Date().toISOString(), previousSource: existing.source },
            source: body.source,
            fullNameEnc: body.fullName ? encrypt(body.fullName) : undefined,
            assignedUserId: req.user?.sub,
            campaignId: body.campaignId ?? undefined,
          },
          include: leadInclude,
        });
        res.json(decryptLead(updated));
        return;
      }
    }

    const lead = await prisma.lead.create({
      data: {
        source: body.source,
        fullNameEnc: body.fullName ? encrypt(body.fullName) : null,
        mobileEnc: body.mobile ? encrypt(body.mobile) : null,
        metadata: JSON.parse(JSON.stringify(body.metadata)),
        externalRef: body.externalRef,
        assignedUserId: req.user?.sub,
        campaignId: body.campaignId,
      },
      include: leadInclude,
    });
    res.status(201).json(decryptLead(lead));
  } catch (e) {
    next(e);
  }
});

leadsRouter.patch("/:id/assign", async (req, res, next) => {
  try {
    const { assignedUserId } = assignLeadSchema.parse(req.body);

    const existing = await prisma.lead.findUnique({ where: { id: req.params.id }, select: { assignedUserId: true } });
    if (!existing) { res.status(404).json({ error: "لید یافت نشد" }); return; }

    if (existing.assignedUserId && existing.assignedUserId !== req.user?.sub && !isSuperAdmin(req)) {
      res.status(403).json({ error: "این لید توسط کاربر دیگری تخصیص داده شده و فقط سوپر ادمین می‌تواند آن را تغییر دهد" });
      return;
    }

    if (assignedUserId && assignedUserId !== existing.assignedUserId) {
      const [assignee, oldAssignee] = await Promise.all([
        prisma.user.findUnique({ where: { id: assignedUserId }, select: { fullName: true } }),
        existing.assignedUserId ? prisma.user.findUnique({ where: { id: existing.assignedUserId }, select: { fullName: true } }) : null,
      ]);
      await prisma.leadInteraction.create({
        data: {
          leadId: req.params.id,
          userId: req.user?.sub,
          type: "ASSIGN",
          content: existing.assignedUserId
            ? `تخصیص از "${oldAssignee?.fullName ?? existing.assignedUserId}" به "${assignee?.fullName ?? assignedUserId}" تغییر کرد`
            : `لید توسط "${assignee?.fullName ?? assignedUserId}" برداشته شد`,
        },
      });
    } else if (assignedUserId === null && existing.assignedUserId) {
      await prisma.leadInteraction.create({
        data: {
          leadId: req.params.id,
          userId: req.user?.sub,
          type: "UNASSIGN",
          content: "تخصیص لید برداشته شد",
        },
      });
    }

    const lead = await prisma.lead.update({
      where: { id: req.params.id },
      data: { assignedUserId },
      include: leadInclude,
    });
    res.json(decryptLead(lead));
  } catch (e) {
    next(e);
  }
});

leadsRouter.patch("/:id/status", async (req, res, next) => {
  try {
    const { status } = updateLeadStatusSchema.parse(req.body);
    const lead = await prisma.lead.findUnique({ where: { id: req.params.id }, select: { assignedUserId: true } });
    if (!lead) { res.status(404).json({ error: "لید یافت نشد" }); return; }
    if (!canModifyLead(lead, req.user?.sub, req)) { res.status(403).json({ error: "این لید تخصیص داده شده و فقط مالک آن یا سوپر ادمین می‌تواند تغییر دهد" }); return; }

    const updated = await prisma.lead.update({
      where: { id: req.params.id },
      data: {
        status,
        contactedAt: status === "CONTACTED" ? new Date() : undefined,
        convertedAt: status === "CONVERTED" ? new Date() : undefined,
      },
      include: leadInclude,
    });
    res.json(decryptLead(updated));
  } catch (e) {
    next(e);
  }
});

leadsRouter.patch("/:id/campaign", async (req, res, next) => {
  try {
    const { campaignId } = assignLeadCampaignSchema.parse(req.body);
    const lead = await prisma.lead.findUnique({ where: { id: req.params.id }, select: { assignedUserId: true, campaignId: true } });
    if (!lead) { res.status(404).json({ error: "لید یافت نشد" }); return; }
    if (!canModifyLead(lead, req.user?.sub, req)) { res.status(403).json({ error: "این لید تخصیص داده شده و فقط مالک آن یا سوپر ادمین می‌تواند تغییر دهد" }); return; }

    if (campaignId) {
      const campaign = await prisma.campaign.findUnique({ where: { id: campaignId }, select: { id: true, name: true } });
      if (!campaign) { res.status(404).json({ error: "کمپین یافت نشد" }); return; }
    }

    if (campaignId !== lead.campaignId) {
      const campaign = campaignId ? await prisma.campaign.findUnique({ where: { id: campaignId }, select: { name: true } }) : null;
      await prisma.leadInteraction.create({
        data: {
          leadId: req.params.id,
          userId: req.user?.sub,
          type: "NOTE",
          content: campaign ? `کمپین لید به «${campaign.name}» تغییر کرد` : "کمپین لید حذف شد",
        },
      });
    }

    const updated = await prisma.lead.update({
      where: { id: req.params.id },
      data: { campaignId },
      include: leadInclude,
    });
    res.json(decryptLead(updated));
  } catch (e) {
    next(e);
  }
});

leadsRouter.post("/:id/calls", async (req, res, next) => {
  try {
    const body = registerCallSchema.parse(req.body);
    const userId = req.user?.sub;

    const leadCheck = await prisma.lead.findUnique({ where: { id: req.params.id }, select: { assignedUserId: true } });
    if (!leadCheck) { res.status(404).json({ error: "لید یافت نشد" }); return; }
    if (!canModifyLead(leadCheck, userId, req)) { res.status(403).json({ error: "این لید تخصیص داده شده و فقط مالک آن یا سوپر ادمین می‌تواند تماس ثبت کند" }); return; }

    const existingFollowUps = await prisma.leadFollowUp.count({
      where: { leadId: req.params.id, status: "PENDING" },
    });

    const result = await prisma.$transaction(async (tx) => {
      const call = await tx.leadCall.create({
        data: {
          leadId: req.params.id,
          userId,
          callStatus: body.callStatus,
          callOutcome: body.callOutcome,
          serviceReceived: body.serviceReceived,
          notes: body.notes,
        },
      });

      let appointment = null;
      let followUp = null;
      const leadUpdate: Record<string, unknown> = {
        lastCallStatus: body.callStatus,
        lastCallOutcome: body.callOutcome,
        serviceReceived: body.serviceReceived,
        contactedAt: new Date(),
        status: "CONTACTED",
      };

      if (body.callStatus !== "ANSWERED") {
        if (body.followUp) {
          followUp = await tx.leadFollowUp.create({
            data: {
              leadId: req.params.id,
              userId,
              scheduledAt: new Date(body.followUp.scheduledAt),
              reason: body.followUp.reason ?? "پاسخ نداد",
              notes: body.followUp.notes,
              attemptNumber: existingFollowUps + 1,
            },
          });
          leadUpdate.nextFollowUpAt = new Date(body.followUp.scheduledAt);
        }
      } else if (body.serviceReceived === true && body.appointment) {
        appointment = await tx.leadAppointment.create({
          data: {
            leadId: req.params.id,
            userId,
            reserveDate: body.appointment.reserveDate,
            reserveTime: body.appointment.reserveTime,
            doctorName: body.appointment.doctorName,
            serviceName: body.appointment.serviceName,
            notes: body.appointment.notes,
          },
        });
        leadUpdate.status = "CONVERTED";
        leadUpdate.convertedAt = new Date();
        leadUpdate.nextFollowUpAt = null;
      } else if (body.serviceReceived === false) {
        if (body.callOutcome === "NO_INTEREST") {
          leadUpdate.status = "LOST";
          leadUpdate.nextFollowUpAt = null;
        } else if (body.followUp) {
          followUp = await tx.leadFollowUp.create({
            data: {
              leadId: req.params.id,
              userId,
              scheduledAt: new Date(body.followUp.scheduledAt),
              reason: body.followUp.reason ?? "خدمت دریافت نشد",
              notes: body.followUp.notes,
              attemptNumber: existingFollowUps + 1,
            },
          });
          leadUpdate.nextFollowUpAt = new Date(body.followUp.scheduledAt);
        }
      }

      const callStatusLabels: Record<string, string> = { ANSWERED: "پاسخ داد", NO_ANSWER: "بدون پاسخ", BUSY: "مشغول", VOICEMAIL: "پیام صوتی", WRONG_NUMBER: "شماره اشتباه" };
      const callOutcomeLabels: Record<string, string> = { SERVICE_ACCEPTED: "خدمت پذیرفت", SERVICE_DECLINED: "خدمت نپذیرفت", CALLBACK_REQUESTED: "تماس مجدد", NO_INTEREST: "تمایلی ندارد" };
      const interactionContent = [
        `وضعیت: ${callStatusLabels[body.callStatus] || body.callStatus}`,
        body.callOutcome ? `نتیجه: ${callOutcomeLabels[body.callOutcome] || body.callOutcome}` : null,
        body.serviceReceived !== undefined ? `خدمت: ${body.serviceReceived ? "بله" : "خیر"}` : null,
        body.notes,
      ].filter(Boolean).join(" | ");

      await tx.leadInteraction.create({
        data: {
          leadId: req.params.id,
          userId,
          type: "CALL",
          content: interactionContent,
        },
      });

      const lead = await tx.lead.update({
        where: { id: req.params.id },
        data: leadUpdate,
        include: leadInclude,
      });

      return { call, appointment, followUp, lead };
    });

    res.status(201).json({
      ...result,
      lead: decryptLead(result.lead),
    });
  } catch (e) {
    next(e);
  }
});

leadsRouter.post("/:id/follow-ups", async (req, res, next) => {
  try {
    const body = createFollowUpSchema.parse(req.body);
    const userId = req.user?.sub;

    const leadCheck = await prisma.lead.findUnique({ where: { id: req.params.id }, select: { assignedUserId: true } });
    if (!leadCheck) { res.status(404).json({ error: "لید یافت نشد" }); return; }
    if (!canModifyLead(leadCheck, userId, req)) { res.status(403).json({ error: "این لید تخصیص داده شده و فقط مالک آن یا سوپر ادمین می‌تواند پیگیری ثبت کند" }); return; }

    const existingFollowUps = await prisma.leadFollowUp.count({
      where: { leadId: req.params.id },
    });

    const followUp = await prisma.leadFollowUp.create({
      data: {
        leadId: req.params.id,
        userId,
        scheduledAt: new Date(body.scheduledAt),
        reason: body.reason,
        notes: body.notes,
        attemptNumber: existingFollowUps + 1,
      },
      include: { user: { select: { id: true, fullName: true } } },
    });

    const lead = await prisma.lead.update({
      where: { id: req.params.id },
      data: {
        nextFollowUpAt: new Date(body.scheduledAt),
        status: "CONTACTED",
      },
      include: leadInclude,
    });

    res.status(201).json({ followUp, lead: decryptLead(lead) });
  } catch (e) {
    next(e);
  }
});

leadsRouter.patch("/:id/follow-ups/:followUpId", async (req, res, next) => {
  try {
    const status = req.body.status as "COMPLETED" | "CANCELLED";
    const followUp = await prisma.leadFollowUp.update({
      where: { id: req.params.followUpId, leadId: req.params.id },
      data: {
        status,
        completedAt: status === "COMPLETED" ? new Date() : undefined,
      },
    });

    const pending = await prisma.leadFollowUp.findFirst({
      where: { leadId: req.params.id, status: "PENDING" },
      orderBy: { scheduledAt: "asc" },
    });

    const lead = await prisma.lead.update({
      where: { id: req.params.id },
      data: { nextFollowUpAt: pending?.scheduledAt ?? null },
      include: leadInclude,
    });

    res.json({ followUp, lead: decryptLead(lead) });
  } catch (e) {
    next(e);
  }
});

leadsRouter.post("/:id/interactions", async (req, res, next) => {
  try {
    const { type, content } = req.body;

    const leadCheck = await prisma.lead.findUnique({ where: { id: req.params.id }, select: { assignedUserId: true } });
    if (!leadCheck) { res.status(404).json({ error: "لید یافت نشد" }); return; }
    if (!canModifyLead(leadCheck, req.user?.sub, req)) { res.status(403).json({ error: "این لید تخصیص داده شده و فقط مالک آن یا سوپر ادمین می‌تواند یادداشت ثبت کند" }); return; }

    const interaction = await prisma.leadInteraction.create({
      data: {
        leadId: req.params.id,
        userId: req.user?.sub,
        type: type ?? "NOTE",
        content,
      },
    });
    res.status(201).json(interaction);
  } catch (e) {
    next(e);
  }
});

leadsRouter.get("/:id/match-patient", async (req, res, next) => {
  try {
    const lead = await prisma.lead.findUnique({
      where: { id: req.params.id },
      select: { mobileEnc: true },
    });
    if (!lead || !lead.mobileEnc) {
      res.json(null);
      return;
    }

    const decrypt = (await import("../security/encryption.js")).decrypt;
    let mobile: string;
    try { mobile = decrypt(lead.mobileEnc); } catch { res.json(null); return; }

    const digits = mobile.replace(/\D/g, "");
    const suffix = digits.slice(-10);

    const patient = await prisma.patient.findFirst({
      where: { mobile: { contains: suffix } },
      select: { id: true, externalCode: true, fullNameEnc: true, fullName: true },
    });

    if (!patient) { res.json(null); return; }

    let fullName: string | null = null;
    try { fullName = patient.fullName ?? decrypt(patient.fullNameEnc); } catch {}

    res.json({ id: patient.id, externalCode: patient.externalCode, fullName });
  } catch (e) {
    next(e);
  }
});

leadsRouter.delete("/:id", async (req, res, next) => {
  try {
    if (!isSuperAdmin(req)) {
      res.status(403).json({ error: "فقط سوپر ادمین می‌تواند لید را حذف کند" });
      return;
    }
    const lead = await prisma.lead.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!lead) { res.status(404).json({ error: "لید یافت نشد" }); return; }
    await prisma.lead.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

export const leadsWebhookRouter = Router();

async function safeWebhookLog(data: Prisma.WebhookLogCreateInput) {
  try {
    await prisma.webhookLog.create({ data });
  } catch (err) {
    console.error("[webhook log]", err instanceof Error ? err.message : err);
  }
}

/** Webhook for Manychat / n8n — secured via shared secret header */
leadsWebhookRouter.post("/", async (req, res) => {
  const ipAddress = (req.headers["x-forwarded-for"] as string || req.socket.remoteAddress || "unknown").split(",")[0]?.trim() ?? "unknown";

  try {
    const configuredSecret = process.env.LEAD_WEBHOOK_SECRET;

    if (configuredSecret) {
      const secret = (req.headers["x-webhook-secret"] as string || "")
        .replace(/^['"]|['"]$/g, "")
        .trim();

      if (!secret || secret !== configuredSecret) {
        await safeWebhookLog({
          source: req.body?.source ?? "unknown",
          action: "rejected",
          name: req.body?.name,
          phone: req.body?.phone,
          externalRef: req.body?.external_id,
          ipAddress,
          metadata: { reason: "invalid_secret" },
        });
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
    }

    const payload = leadWebhookSchema.parse(req.body);
    const phone = payload.phone?.replace(/\s+/g, "");
    const logSource = payload.rawSource;

    if (phone) {
      const existing = await prisma.lead.findFirst({
        where: { mobileEnc: encrypt(phone) },
      });
      if (existing) {
        await safeWebhookLog({
          source: logSource,
          action: "duplicate",
          name: payload.name,
          phone,
          externalRef: payload.external_id,
          ipAddress,
          metadata: { existingLeadId: existing.id },
        });
        res.status(200).json({ id: existing.id, duplicate: true });
        return;
      }
    }

    const metadata = {
      ...(payload.payload ?? {}),
      _webhookSource: payload.rawSource,
    };

    let campaignId: string | null = null;
    if (payload.campaign_id || payload.campaign_slug) {
      const campaign = await prisma.campaign.findFirst({
        where: {
          OR: [
            ...(payload.campaign_id ? [{ id: payload.campaign_id }] : []),
            ...(payload.campaign_slug ? [{ slug: payload.campaign_slug }] : []),
          ],
        },
        select: { id: true },
      });
      if (campaign) campaignId = campaign.id;
    }

    const lead = await prisma.lead.create({
      data: {
        source: sourceMap[payload.source],
        fullNameEnc: payload.name ? encrypt(payload.name) : null,
        mobileEnc: phone ? encrypt(phone) : null,
        metadata: JSON.parse(JSON.stringify(metadata)),
        externalRef: payload.external_id,
        campaignId,
      },
    });

    await safeWebhookLog({
      source: logSource,
      action: "created",
      name: payload.name,
      phone,
      externalRef: payload.external_id,
      ipAddress,
      metadata: { leadId: lead.id },
    });

    try {
      await prisma.auditLog.create({
        data: {
          action: "WEBHOOK_RECEIVED",
          resource: `lead:${lead.id}`,
          ipAddress,
          metadata: { source: logSource, externalRef: payload.external_id },
        },
      });
    } catch (err) {
      console.error("[webhook audit]", err instanceof Error ? err.message : err);
    }

    res.status(201).json({ id: lead.id });
  } catch (e) {
    if (e instanceof ZodError) {
      await safeWebhookLog({
        source: req.body?.source ?? "unknown",
        action: "rejected",
        name: req.body?.name,
        phone: req.body?.phone,
        externalRef: req.body?.external_id,
        ipAddress,
        metadata: { validationError: JSON.parse(JSON.stringify(e.errors)) },
        errorMsg: e.message,
      });
      res.status(400).json({ error: "داده نامعتبر", details: e.errors });
      return;
    }
    console.error("[webhook]", e instanceof Error ? e.message : e);
    res.status(500).json({ error: "خطای داخلی سرور" });
  }
});
