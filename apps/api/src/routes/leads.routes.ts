import { Router } from "express";
import { prisma, AuditAction } from "@jordan/db";
import { createLeadSchema, leadWebhookSchema, updateLeadStatusSchema } from "@jordan/shared";
import { createEncryptFn, decrypt } from "../security/encryption.js";
import { ZodError } from "zod";

export const leadsRouter = Router();
const encrypt = createEncryptFn();

const sourceMap = {
  instagram: "INSTAGRAM" as const,
  whatsapp: "WHATSAPP" as const,
  site: "SITE" as const,
};

leadsRouter.get("/", async (req, res, next) => {
  try {
    const status = req.query.status as string | undefined;
    const source = req.query.source as string | undefined;
    const sourceList = source ? source.split(",").filter(Boolean) as ("INSTAGRAM" | "WHATSAPP" | "SITE" | "MANUAL")[] : undefined;
    const leads = await prisma.lead.findMany({
      where: {
        ...(status ? { status: status as "NEW" | "CONTACTED" | "CONVERTED" | "LOST" } : {}),
        ...(sourceList ? { source: { in: sourceList } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        interactions: {
          orderBy: { createdAt: "desc" },
          take: 10,
        },
      },
    });

    const decrypted = leads.map((l) => {
      let fullName: string | null = null;
      let mobile: string | null = null;
      try {
        fullName = l.fullNameEnc ? decrypt(l.fullNameEnc) : null;
        mobile = l.mobileEnc ? decrypt(l.mobileEnc) : null;
      } catch {}
      return {
        ...l,
        fullName,
        mobile,
        fullNameEnc: undefined,
        mobileEnc: undefined,
      };
    });
    res.json(decrypted);
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
      },
    });
    if (!lead) {
      res.status(404).json({ error: "لید یافت نشد" });
      return;
    }
    let fullName: string | null = null;
    let mobile: string | null = null;
    try {
      fullName = lead.fullNameEnc ? decrypt(lead.fullNameEnc) : null;
      mobile = lead.mobileEnc ? decrypt(lead.mobileEnc) : null;
    } catch {}
    res.json({ ...lead, fullName, mobile, fullNameEnc: undefined, mobileEnc: undefined });
  } catch (e) {
    next(e);
  }
});

leadsRouter.post("/", async (req, res, next) => {
  try {
    const body = createLeadSchema.parse(req.body);
    const lead = await prisma.lead.create({
      data: {
        source: body.source,
        fullNameEnc: body.fullName ? encrypt(body.fullName) : null,
        mobileEnc: body.mobile ? encrypt(body.mobile) : null,
        metadata: JSON.parse(JSON.stringify(body.metadata)),
        externalRef: body.externalRef,
      },
    });
    res.status(201).json(lead);
  } catch (e) {
    next(e);
  }
});

leadsRouter.patch("/:id/status", async (req, res, next) => {
  try {
    const { status } = updateLeadStatusSchema.parse(req.body);
    const lead = await prisma.lead.update({
      where: { id: req.params.id },
      data: {
        status,
        contactedAt: status === "CONTACTED" ? new Date() : undefined,
        convertedAt: status === "CONVERTED" ? new Date() : undefined,
      },
    });
    res.json(lead);
  } catch (e) {
    next(e);
  }
});

leadsRouter.post("/:id/interactions", async (req, res, next) => {
  try {
    const { type, content } = req.body;
    const interaction = await prisma.leadInteraction.create({
      data: {
        leadId: req.params.id,
        type: type ?? "NOTE",
        content,
      },
    });
    res.status(201).json(interaction);
  } catch (e) {
    next(e);
  }
});

export const leadsWebhookRouter = Router();

/** Webhook for Manychat / n8n — secured via shared secret header */
leadsWebhookRouter.post("/", async (req, res, next) => {
  const ipAddress = (req.headers["x-forwarded-for"] as string || req.socket.remoteAddress || "unknown").split(",")[0]?.trim() ?? "unknown";

  try {
    const configuredSecret = process.env.LEAD_WEBHOOK_SECRET;

    if (configuredSecret) {
      const secret = (req.headers["x-webhook-secret"] as string || "")
        .replace(/^['"]|['"]$/g, "")
        .trim();

      if (!secret || secret !== configuredSecret) {
        await prisma.webhookLog.create({
          data: {
            source: req.body?.source ?? "unknown",
            action: "rejected",
            name: req.body?.name,
            phone: req.body?.phone,
            externalRef: req.body?.external_id,
            ipAddress,
            metadata: { reason: "invalid_secret" },
          },
        });
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
    }

    const payload = leadWebhookSchema.parse(req.body);
    const phone = payload.phone?.replace(/\s+/g, "");

    if (phone) {
      const existing = await prisma.lead.findFirst({
        where: { mobileEnc: encrypt(phone) },
      });
      if (existing) {
        await prisma.webhookLog.create({
          data: {
            source: payload.source,
            action: "duplicate",
            name: payload.name,
            phone,
            externalRef: payload.external_id,
            ipAddress,
            metadata: { existingLeadId: existing.id },
          },
        });
        res.status(200).json({ id: existing.id, duplicate: true });
        return;
      }
    }

    const lead = await prisma.lead.create({
      data: {
        source: sourceMap[payload.source],
        fullNameEnc: payload.name ? encrypt(payload.name) : null,
        mobileEnc: phone ? encrypt(phone) : null,
        metadata: JSON.parse(JSON.stringify(payload.payload ?? {})),
        externalRef: payload.external_id,
      },
    });

    await prisma.webhookLog.create({
      data: {
        source: payload.source,
        action: "created",
        name: payload.name,
        phone,
        externalRef: payload.external_id,
        ipAddress,
        metadata: { leadId: lead.id },
      },
    });

    await prisma.auditLog.create({
      data: {
        action: "WEBHOOK_RECEIVED",
        resource: `lead:${lead.id}`,
        ipAddress,
        metadata: { source: payload.source, externalRef: payload.external_id },
      },
    });

    res.status(201).json({ id: lead.id });
  } catch (e) {
    if (e instanceof ZodError) {
      await prisma.webhookLog.create({
        data: {
          source: req.body?.source ?? "unknown",
          action: "rejected",
          name: req.body?.name,
          phone: req.body?.phone,
          externalRef: req.body?.external_id,
          ipAddress,
          metadata: { validationError: (e as Error).message },
        },
      });
    }
    next(e);
  }
});
