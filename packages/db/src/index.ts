export { prisma } from "./client.js";

import pkg from "@prisma/client";
import type {
  AuditAction as AuditActionType,
  CallOutcome as CallOutcomeType,
  CallStatus as CallStatusType,
  CampaignStatus as CampaignStatusType,
  FollowUpStatus as FollowUpStatusType,
  LeadSource as LeadSourceType,
  LeadStatus as LeadStatusType,
  Prisma,
  PrismaClient as PrismaClientType,
  SyncEntity as SyncEntityType,
  SyncStatus as SyncStatusType,
  SyncTrigger as SyncTriggerType,
  SyncJobStatus as SyncJobStatusType,
} from "@prisma/client";

// Prisma ships as CJS; ESM named imports/re-exports break at runtime in Node.
export const PrismaClient = pkg.PrismaClient;
export type PrismaClient = PrismaClientType;

export const AuditAction = pkg.AuditAction;
export type AuditAction = AuditActionType;

export const LeadSource = pkg.LeadSource;
export type LeadSource = LeadSourceType;

export const LeadStatus = pkg.LeadStatus;
export type LeadStatus = LeadStatusType;

export const CallStatus = pkg.CallStatus;
export type CallStatus = CallStatusType;

export const CallOutcome = pkg.CallOutcome;
export type CallOutcome = CallOutcomeType;

export const FollowUpStatus = pkg.FollowUpStatus;
export type FollowUpStatus = FollowUpStatusType;

export const CampaignStatus = pkg.CampaignStatus;
export type CampaignStatus = CampaignStatusType;

export const SyncEntity = pkg.SyncEntity;
export type SyncEntity = SyncEntityType;

export const SyncStatus = pkg.SyncStatus;
export type SyncStatus = SyncStatusType;

export const SyncTrigger = pkg.SyncTrigger;
export type SyncTrigger = SyncTriggerType;

export const SyncJobStatus = pkg.SyncJobStatus;
export type SyncJobStatus = SyncJobStatusType;

export type { Prisma };
