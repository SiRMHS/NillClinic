export { prisma } from "./client.js";

import pkg from "@prisma/client";
import type {
  AuditAction as AuditActionType,
  LeadSource as LeadSourceType,
  LeadStatus as LeadStatusType,
  Prisma,
  PrismaClient as PrismaClientType,
  SyncEntity as SyncEntityType,
  SyncStatus as SyncStatusType,
  SyncTrigger as SyncTriggerType,
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

export const SyncEntity = pkg.SyncEntity;
export type SyncEntity = SyncEntityType;

export const SyncStatus = pkg.SyncStatus;
export type SyncStatus = SyncStatusType;

export const SyncTrigger = pkg.SyncTrigger;
export type SyncTrigger = SyncTriggerType;

export type { Prisma };
