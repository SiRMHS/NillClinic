/**
 * Every reachable section, with the access key that opens it.
 *
 * This one list drives three things that used to be maintained separately and
 * therefore drifted: which rows the sidebar renders, which page a direct URL
 * may open, and where a user lands after logging in. A section missing from
 * here is invisible to the sidebar but *not* protected — so add new pages here
 * as well as gating their API routes.
 */

export interface SectionDef {
  /** Route the section lives at; child routes inherit its access key. */
  url: string
  title: string
  /** Holding any one of these opens the section. */
  anyOf: string[]
  group: "main" | "analysis" | "settings"
}

export const SECTIONS: SectionDef[] = [
  { url: "/dashboard", title: "داشبورد", anyOf: ["dashboard"], group: "main" },
  { url: "/patients", title: "بیماران", anyOf: ["patients", "patients.view"], group: "main" },
  { url: "/leads", title: "لیدها", anyOf: ["leads"], group: "main" },
  { url: "/my-leads", title: "لیدهای من", anyOf: ["leads"], group: "main" },
  { url: "/campaigns", title: "کمپین‌ها", anyOf: ["campaigns"], group: "main" },

  { url: "/crm-desk", title: "CRM", anyOf: ["crm.desk"], group: "analysis" },
  { url: "/crm", title: "تحلیل مراجعین", anyOf: ["crm"], group: "analysis" },
  { url: "/analytics/medical", title: "تحلیل درمانی", anyOf: ["analytics.medical"], group: "analysis" },
  { url: "/analytics/doctors", title: "تحلیل پزشکان", anyOf: ["analytics.doctors"], group: "analysis" },
  { url: "/analytics", title: "تحلیل‌ها", anyOf: ["analytics"], group: "analysis" },
  { url: "/financial/patients", title: "رتبه‌بندی بیماران", anyOf: ["financial.patients"], group: "analysis" },
  { url: "/financial", title: "تحلیل مالی", anyOf: ["financial"], group: "analysis" },
  { url: "/tiers", title: "رتبه ارزش و فعالیت", anyOf: ["financial.tiers"], group: "analysis" },
  { url: "/reports/doctors", title: "گزارش پزشکان", anyOf: ["reports.doctors"], group: "analysis" },
  { url: "/reports/referrals", title: "ارجاع پس از مشاوره", anyOf: ["reports.referrals"], group: "analysis" },

  { url: "/sync", title: "سینک CRM", anyOf: ["sync"], group: "settings" },
  { url: "/settings/external-migration", title: "ورودی خارجی", anyOf: ["settings.external-migration"], group: "settings" },
  { url: "/settings/leads-log", title: "لاگ ورودی‌ها", anyOf: ["settings.leads-log"], group: "settings" },
  { url: "/settings/leads-bank", title: "بانک لیدها", anyOf: ["settings.leads-bank"], group: "settings" },
  { url: "/settings/webhook-logs", title: "لاگ وب‌هوک", anyOf: ["settings.webhook-logs"], group: "settings" },
  { url: "/settings/users", title: "کاربران و نقش‌ها", anyOf: ["settings.users", "settings.roles"], group: "settings" },
  { url: "/settings/login-log", title: "گزارش ورود", anyOf: ["settings.login-log"], group: "settings" },
  { url: "/settings/telephony", title: "تنظیمات تلفن", anyOf: ["settings.telephony"], group: "settings" },
  { url: "/settings/display", title: "تنظیمات نمایش", anyOf: ["settings.display"], group: "settings" },
]

/**
 * The section a path belongs to, matched on the longest url so
 * `/analytics/medical` resolves to itself rather than to `/analytics`.
 */
export function sectionForPath(pathname: string): SectionDef | null {
  const matches = SECTIONS.filter(
    (s) => pathname === s.url || pathname.startsWith(s.url + "/"),
  )
  if (!matches.length) return null
  return matches.reduce((a, b) => (b.url.length > a.url.length ? b : a))
}

/** First section the user can actually open — used as a post-login landing. */
export function firstAllowedSection(
  hasPermission: (perm: string) => boolean,
): SectionDef | null {
  return SECTIONS.find((s) => s.anyOf.some(hasPermission)) ?? null
}
