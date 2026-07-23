import { z } from "zod";
import { leadSourceSchema } from "./lead.js";

export const campaignStatusSchema = z.enum(["ACTIVE", "PAUSED", "ARCHIVED"]);

export const createCampaignSchema = z.object({
  name: z.string().min(1).max(120),
  slug: z.string().min(1).max(80).optional(),
  source: leadSourceSchema.optional(),
  status: campaignStatusSchema.default("ACTIVE"),
  budget: z.number().int().nonnegative().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  notes: z.string().max(2000).optional(),
});

export const updateCampaignSchema = createCampaignSchema.partial();

export const assignLeadCampaignSchema = z.object({
  campaignId: z.string().nullable(),
});

export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;
export type UpdateCampaignInput = z.infer<typeof updateCampaignSchema>;
