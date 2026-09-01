import type {
  CrmCallResult, CrmChannel, CrmContactKind, CrmLikelihood, CrmRating,
} from "@jordan/shared"

export type NpsBucket = "PROMOTER" | "PASSIVE" | "DETRACTOR"
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH"

/** One row of the desk — the API returns the derived scores alongside the raw fields. */
export interface CrmContact {
  id: string
  kind: CrmContactKind
  patientId: string | null
  patientExternalCode: number | null
  patientName: string | null
  patientMobile: string | null
  doctorName: string | null
  visitDate: string | null
  contactDate: string
  serviceName: string | null
  serviceNames: string[]
  amountText: string | null
  amount: number | null
  schedulingRating: CrmRating | null
  doctorRating: CrmRating | null
  assistantRating: CrmRating | null
  receptionRating: CrmRating | null
  hygieneRating: CrmRating | null
  referralLikelihood: CrmLikelihood | null
  revisitLikelihood: CrmLikelihood | null
  channels: CrmChannel[]
  callResult: CrmCallResult | null
  suggestion: string | null
  notes: string | null
  rebookNote: string | null
  resultsOnset: string | null
  sideEffect: string | null
  overallOpinion: string | null
  painSwelling: string | null
  delayComplaint: string | null
  positiveNote: string | null
  doctorReferral: string | null
  patientSummary: string | null
  callCenterReferral: string | null
  resurveyDate: string | null
  resurveyResult: string | null
  referredDoctorName: string | null
  treatmentDoctorName: string | null
  treatmentServiceNames: string[]
  treatmentDate: string | null
  createdBy: { id: string; fullName: string | null } | null
  createdAt: string
  satisfaction: number | null
  npsBucket: NpsBucket | null
  churnRisk: number | null
  riskLevel: RiskLevel | null
  loyalty: number | null
}

export interface ContactsResponse {
  data: CrmContact[]
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
}

export interface CrmKpi {
  totalContacts: number
  ratedContacts: number
  answeredContacts: number
  answerRate: number | null
  satisfaction: number | null
  nps: number | null
  rebookRate: number | null
  rebookCount: number
  atRiskCount: number
  revenue: number
  dimensionAverages: { key: string; label: string; average: number | null; responses: number }[]
  trend: { period: string; contacts: number; satisfaction: number | null; nps: number | null }[]
  channels: { channel: CrmChannel; count: number }[]
}

export interface DoctorScore {
  doctorName: string
  contacts: number
  patients: number
  satisfaction: number | null
  scheduling: number | null
  doctor: number | null
  assistant: number | null
  reception: number | null
  hygiene: number | null
  nps: number | null
  churnRisk: number | null
  highRiskCount: number
  loyalty: number | null
  vip: boolean
  revenue: number
}

/** One entry of a "top N by count" list — the CRM referral report's shape. */
export interface NamedCount {
  name: string
  count: number
}

/**
 * Where consultations were sent and what came of them, as recorded by the desk.
 *
 * Deliberately separate from /reports/referrals, which reconstructs the same
 * journey from billed lines: that one is authoritative on money and blind to
 * referrals that never produced an invoice, which are exactly the ones the desk
 * needs to chase.
 */
export interface CrmReferralReport {
  totalReferrals: number
  treatedCount: number
  pendingCount: number
  completionRate: number | null
  /** Treated by someone other than the doctor they were referred to. */
  redirectedCount: number
  byDoctor: {
    referredDoctorName: string
    referrals: number
    patients: number
    treated: number
    pending: number
    completionRate: number | null
    fromDoctors: NamedCount[]
    treatedBy: NamedCount[]
    services: NamedCount[]
  }[]
  topServices: NamedCount[]
}

export interface ScheduleEntry {
  id: string
  doctorName: string
  weekday: number
  note: string | null
}

/** Which rating tone a score maps to, shared by the badges and the score bars. */
export function ratingTone(score: number | null): string {
  if (score === null) return "text-muted-foreground"
  if (score >= 80) return "text-emerald-600 dark:text-emerald-400"
  if (score >= 60) return "text-amber-600 dark:text-amber-400"
  return "text-rose-600 dark:text-rose-400"
}

export const RISK_TONE: Record<RiskLevel, string> = {
  LOW: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  MEDIUM: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  HIGH: "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300",
}

export const NPS_TONE: Record<NpsBucket, string> = {
  PROMOTER: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  PASSIVE: "border-slate-500/40 bg-slate-500/10 text-slate-700 dark:text-slate-300",
  DETRACTOR: "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300",
}
