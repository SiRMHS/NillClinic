import { PATIENT_TIER_LABELS, PATIENT_TIER_ORDER, type PatientTier } from "@jordan/shared"

/**
 * Tier styling, shared by every surface that shows a tier.
 *
 * The palette follows the metals rather than a semantic scale, because the tier
 * names already tell the reader which is which — a green/amber/red ramp would
 * read as "healthy / warning / bad", which is not what a spend tier means. Gray
 * is deliberately the flattest, since it marks patients with no spend at all.
 */
export const TIER_TONE: Record<PatientTier, string> = {
  PLATINUM: "bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200",
  GOLD: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  SILVER: "bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-100",
  BRONZE: "bg-orange-100 text-orange-900 dark:bg-orange-950/60 dark:text-orange-200",
  GRAY: "bg-muted text-muted-foreground",
}

/** Ring/border tone for the selectable tier cards. */
export const TIER_RING: Record<PatientTier, string> = {
  PLATINUM: "border-violet-400 ring-violet-400/30",
  GOLD: "border-amber-400 ring-amber-400/30",
  SILVER: "border-slate-400 ring-slate-400/30",
  BRONZE: "border-orange-400 ring-orange-400/30",
  GRAY: "border-muted-foreground/40 ring-muted-foreground/20",
}

export { PATIENT_TIER_LABELS, PATIENT_TIER_ORDER }
export type { PatientTier }

export function TierBadge({ tier, className = "" }: { tier: PatientTier; className?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap ${TIER_TONE[tier]} ${className}`}
    >
      {PATIENT_TIER_LABELS[tier]}
    </span>
  )
}
