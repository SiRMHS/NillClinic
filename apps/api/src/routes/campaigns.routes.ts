import { Router } from "express";
import { prisma, type Prisma } from "@jordan/db";
import {
  createCampaignSchema,
  updateCampaignSchema,
} from "@jordan/shared";
import { decrypt } from "../security/encryption.js";

export const campaignsRouter = Router();

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

async function resolveCampaign(
  idOrSlug: string,
  tx: Prisma.TransactionClient | typeof prisma = prisma,
) {
  return tx.campaign.findFirst({
    where: {
      OR: [{ id: idOrSlug }, { slug: idOrSlug }],
    },
  });
}

const leadInclude = {
  interactions: { orderBy: { createdAt: "desc" as const }, take: 10, include: { user: { select: { id: true, fullName: true } } } },
  calls: { orderBy: { createdAt: "desc" as const }, take: 5, include: { user: { select: { id: true, fullName: true } } } },
  followUps: { orderBy: { scheduledAt: "asc" as const }, take: 5, include: { user: { select: { id: true, fullName: true } } } },
  appointments: { orderBy: { createdAt: "desc" as const }, take: 3, include: { user: { select: { id: true, fullName: true } } } },
  assignedUser: { select: { id: true, fullName: true, email: true } },
  campaign: { select: { id: true, name: true, slug: true } },
};

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

// GET / — list with aggregated conversion stats
campaignsRouter.get("/", async (_req, res, next) => {
  try {
    const campaigns = await prisma.campaign.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { leads: true } },
      },
    });

    const stats = await prisma.lead.groupBy({
      by: ["campaignId", "status"],
      _count: { _all: true },
      where: { campaignId: { not: null } },
    });

    const statMap = new Map<string, { total: number; NEW: number; CONTACTED: number; CONVERTED: number; LOST: number }>();
    for (const row of stats) {
      const cid = row.campaignId!;
      const entry = statMap.get(cid) ?? { total: 0, NEW: 0, CONTACTED: 0, CONVERTED: 0, LOST: 0 };
      entry.total += row._count._all;
      entry[row.status] += row._count._all;
      statMap.set(cid, entry);
    }

    const result = campaigns.map((c) => {
      const s = statMap.get(c.id) ?? { total: 0, NEW: 0, CONTACTED: 0, CONVERTED: 0, LOST: 0 };
      const rate = s.total > 0 ? Math.round((s.CONVERTED / s.total) * 1000) / 10 : 0;
      return {
        id: c.id,
        name: c.name,
        slug: c.slug,
        source: c.source,
        status: c.status,
        budget: c.budget,
        startDate: c.startDate,
        endDate: c.endDate,
        notes: c.notes,
        createdAt: c.createdAt,
        leadsCount: s.total,
        newCount: s.NEW,
        contactedCount: s.CONTACTED,
        convertedCount: s.CONVERTED,
        lostCount: s.LOST,
        conversionRate: rate,
      };
    });

    res.json(result);
  } catch (e) {
    next(e);
  }
});

campaignsRouter.post("/", async (req, res, next) => {
  try {
    const body = createCampaignSchema.parse(req.body);
    const slug = body.slug ? slugify(body.slug) : slugify(body.name);

    const existing = await prisma.campaign.findFirst({ where: { slug }, select: { id: true } });
    const finalSlug = existing ? `${slug}-${Date.now().toString(36)}` : slug;

    const campaign = await prisma.campaign.create({
      data: {
        name: body.name,
        slug: finalSlug,
        source: body.source,
        status: body.status,
        budget: body.budget,
        startDate: body.startDate ? new Date(body.startDate) : undefined,
        endDate: body.endDate ? new Date(body.endDate) : undefined,
        notes: body.notes,
      },
    });
    res.status(201).json(campaign);
  } catch (e) {
    next(e);
  }
});

campaignsRouter.patch("/:id", async (req, res, next) => {
  try {
    const body = updateCampaignSchema.parse(req.body);
    const existing = await prisma.campaign.findUnique({ where: { id: req.params.id } });
    if (!existing) { res.status(404).json({ error: "کمپین یافت نشد" }); return; }

    const data: Prisma.CampaignUpdateInput = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.slug !== undefined) data.slug = slugify(body.slug);
    if (body.source !== undefined) data.source = body.source;
    if (body.status !== undefined) data.status = body.status;
    if (body.budget !== undefined) data.budget = body.budget;
    if (body.startDate !== undefined) data.startDate = body.startDate ? new Date(body.startDate) : null;
    if (body.endDate !== undefined) data.endDate = body.endDate ? new Date(body.endDate) : null;
    if (body.notes !== undefined) data.notes = body.notes;

    const campaign = await prisma.campaign.update({ where: { id: req.params.id }, data });
    res.json(campaign);
  } catch (e) {
    next(e);
  }
});

campaignsRouter.delete("/:id", async (req, res, next) => {
  try {
    const existing = await prisma.campaign.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!existing) { res.status(404).json({ error: "کمپین یافت نشد" }); return; }
    await prisma.campaign.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// GET /:idOrSlug — campaign detail with funnel stats
campaignsRouter.get("/:idOrSlug", async (req, res, next) => {
  try {
    const campaign = await resolveCampaign(req.params.idOrSlug);
    if (!campaign) { res.status(404).json({ error: "کمپین یافت نشد" }); return; }

    const grouped = await prisma.lead.groupBy({
      by: ["status"],
      _count: { _all: true },
      where: { campaignId: campaign.id },
    });

    const counts = { NEW: 0, CONTACTED: 0, CONVERTED: 0, LOST: 0 };
    let total = 0;
    for (const row of grouped) {
      counts[row.status] = row._count._all;
      total += row._count._all;
    }
    const conversionRate = total > 0 ? Math.round((counts.CONVERTED / total) * 1000) / 10 : 0;

    res.json({
      ...campaign,
      stats: { total, ...counts, conversionRate },
    });
  } catch (e) {
    next(e);
  }
});

// GET /:idOrSlug/leads — paginated leads of a campaign
campaignsRouter.get("/:idOrSlug/leads", async (req, res, next) => {
  try {
    const campaign = await resolveCampaign(req.params.idOrSlug);
    if (!campaign) { res.status(404).json({ error: "کمپین یافت نشد" }); return; }

    const status = req.query.status as string | undefined;
    const where: Prisma.LeadWhereInput = { campaignId: campaign.id };
    if (status) where.status = status as "NEW" | "CONTACTED" | "CONVERTED" | "LOST";

    const take = Number(req.query.take ?? 100);
    const leads = await prisma.lead.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(take, 1), 500),
      include: leadInclude,
    });

    res.json(leads.map(decryptLead));
  } catch (e) {
    next(e);
  }
});
