import {
  PATIENT_TIER_LABELS,
  PATIENT_TIER_ORDER,
  PATIENT_VIP_FLAG_LABELS,
  type PatientTier,
  type PatientVipFlag,
} from "@jordan/shared"

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

/**
 * Hand-assigned standing, shown beside the spend tier rather than instead of it.
 *
 * The two answer different questions — the tier is what the patient has been
 * worth, the flag is what the clinic has decided about them — and replacing one
 * with the other would hide the fact that a celebrity has spent nothing yet.
 * A flagged patient is PLATINUM in the tier column regardless, so the badge is
 * the only thing on screen that says *why*.
 */
export const VIP_TONE: Record<PatientVipFlag, string> = {
  VIP: "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  CELEBRITY: "border-fuchsia-500/50 bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300",
}

export function VipBadge({
  flag,
  className = "",
}: {
  flag: PatientVipFlag | null | undefined
  className?: string
}) {
  if (!flag) return null
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${VIP_TONE[flag]} ${className}`}
    >
      {PATIENT_VIP_FLAG_LABELS[flag]}
    </span>
  )
}

export { PATIENT_VIP_FLAG_LABELS }
export type { PatientVipFlag }
