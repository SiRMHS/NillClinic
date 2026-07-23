import { z } from "zod";

export const leadSourceSchema = z.enum(["INSTAGRAM", "WHATSAPP", "SITE", "MANUAL"]);
export const leadStatusSchema = z.enum(["NEW", "CONTACTED", "CONVERTED", "LOST"]);
export const callStatusSchema = z.enum(["ANSWERED", "NO_ANSWER", "BUSY", "VOICEMAIL", "WRONG_NUMBER"]);
export const callOutcomeSchema = z.enum(["SERVICE_ACCEPTED", "SERVICE_DECLINED", "CALLBACK_REQUESTED", "NO_INTEREST"]);
export const followUpStatusSchema = z.enum(["PENDING", "COMPLETED", "CANCELLED"]);

export const createLeadSchema = z.object({
  source: leadSourceSchema,
  fullName: z.string().min(1).optional(),
  mobile: z.string().min(10).optional(),
  metadata: z.record(z.unknown()).default({}),
  externalRef: z.string().optional(),
  campaignId: z.string().optional(),
});

export const updateLeadStatusSchema = z.object({
  status: leadStatusSchema,
});

export const assignLeadSchema = z.object({
  assignedUserId: z.string().nullable(),
});

export const registerCallSchema = z.object({
  callStatus: callStatusSchema,
  callOutcome: callOutcomeSchema.optional(),
  serviceReceived: z.boolean().optional(),
  notes: z.string().optional(),
  appointment: z.object({
    reserveDate: z.string().min(1),
    reserveTime: z.string().min(1),
    doctorName: z.string().min(1),
    serviceName: z.string().optional(),
    notes: z.string().optional(),
  }).optional(),
  followUp: z.object({
    scheduledAt: z.string().datetime(),
    reason: z.string().optional(),
    notes: z.string().optional(),
  }).optional(),
});

export const createFollowUpSchema = z.object({
  scheduledAt: z.string().datetime(),
  reason: z.string().optional(),
  notes: z.string().optional(),
});

export type WebhookLeadSource = "instagram" | "whatsapp" | "site";

const webhookSourceAliases: Record<string, WebhookLeadSource> = {
  instagram: "instagram",
  instagram_manychat: "instagram",
  manychat: "instagram",
  whatsapp: "whatsapp",
  whatsapp_n8n: "whatsapp",
  n8n: "whatsapp",
  site: "site",
  website: "site",
  web: "site",
};

export function normalizeWebhookSource(raw: string): WebhookLeadSource | null {
  return webhookSourceAliases[raw.toLowerCase()] ?? null;
}

const payloadValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.union([z.string(), z.number()])),
  z.record(z.unknown()),
]);

export const leadWebhookSchema = z
  .object({
    source: z.string().min(1),
    name: z.string().optional(),
    phone: z.string().optional(),
    external_id: z.string().optional(),
    campaign_id: z.string().optional(),
    campaign_slug: z.string().optional(),
    payload: z.record(payloadValueSchema).optional(),
  })
  .transform((data, ctx) => {
    const normalized = normalizeWebhookSource(data.source);
    if (!normalized) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `منبع نامعتبر: ${data.source}. مقادیر مجاز: instagram, instagram_manychat, whatsapp, site و ...`,
        path: ["source"],
      });
      return z.NEVER;
    }
    return {
      source: normalized,
      rawSource: data.source,
      name: data.name,
      phone: data.phone,
      external_id: data.external_id,
      campaign_id: data.campaign_id,
      campaign_slug: data.campaign_slug,
      payload: data.payload,
    };
  });

export type CreateLeadInput = z.infer<typeof createLeadSchema>;
export type LeadWebhookPayload = z.infer<typeof leadWebhookSchema>;
export type RegisterCallInput = z.infer<typeof registerCallSchema>;
