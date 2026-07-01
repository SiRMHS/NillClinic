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

export const leadWebhookSchema = z.object({
  source: z.enum(["instagram", "whatsapp", "site"]),
  name: z.string().optional(),
  phone: z.string().optional(),
  external_id: z.string().optional(),
  payload: z.record(z.unknown()).optional(),
});

export type CreateLeadInput = z.infer<typeof createLeadSchema>;
export type LeadWebhookPayload = z.infer<typeof leadWebhookSchema>;
export type RegisterCallInput = z.infer<typeof registerCallSchema>;
