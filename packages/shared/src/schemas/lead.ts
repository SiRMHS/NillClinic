import { z } from "zod";

export const leadSourceSchema = z.enum(["INSTAGRAM", "WHATSAPP", "SITE", "MANUAL"]);
export const leadStatusSchema = z.enum(["NEW", "CONTACTED", "CONVERTED", "LOST"]);

export const createLeadSchema = z.object({
  source: leadSourceSchema,
  fullName: z.string().min(1).optional(),
  mobile: z.string().min(10).optional(),
  metadata: z.record(z.unknown()).default({}),
  externalRef: z.string().optional(),
});

export const updateLeadStatusSchema = z.object({
  status: leadStatusSchema,
});

export const leadWebhookSchema = z.object({
  source: z.enum(["instagram", "whatsapp", "site"]),
  name: z.string().optional(),
  phone: z.string().optional(),
  external_id: z.string().optional(),
  payload: z.record(z.unknown()).optional(),
});

export type CreateLeadInput = z.infer<typeof createLeadSchema>;
export type LeadWebhookPayload = z.infer<typeof leadWebhookSchema>;
