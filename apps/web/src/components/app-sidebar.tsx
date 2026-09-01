"use client"

import * as React from "react"
import { useEffect, useState } from "react"
import { NavUser } from "@/components/nav-user"
import { ClinicBrand } from "@/components/clinic-brand"
import { apiFetch } from "@/lib/api-client"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { useTheme } from "@/lib/theme-provider"
import { usePathname } from "next/navigation"
import Link from "next/link"
import {
  Sun, Moon, LayoutDashboardIcon, UsersIcon, BarChart3Icon,
  BanknoteIcon, CrownIcon,
  RefreshCwIcon, StethoscopeIcon, DatabaseIcon,
  ClipboardListIcon, WebhookIcon, UserCogIcon,
  Activity as ActivityIcon, HeadphonesIcon, MegaphoneIcon,
  ContactRoundIcon, ShieldIcon, GemIcon, GitBranchIcon, FileSpreadsheetIcon,
  HeartHandshakeIcon, PhoneIcon, EyeOffIcon,
} from "lucide-react"

import { useAuth } from "@/stores/auth.store"
import { SECTIONS, type SectionDef } from "@/lib/permissions"
import { toPersianNum } from "@/components/leads/constants"
import type { LucideIcon } from "lucide-react"

type NavItem = {
  title: string
  url: string
  icon: LucideIcon
  badge?: number
  badgeTone?: "primary" | "warning"
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname()
  const { theme, toggle } = useTheme()
  const { user, hasPermission } = useAuth()
  const [counts, setCounts] = useState<{ newUnassigned: number; myOverdueFollowUps: number } | null>(null)

  useEffect(() => {
    if (!user) return
    let active = true
    const load = () => {
      apiFetch<{ newUnassigned: number; myActive: number; myOverdueFollowUps: number }>("/api/leads/counts")
        .then((c) => { if (active) setCounts({ newUnassigned: c.newUnassigned, myOverdueFollowUps: c.myOverdueFollowUps }) })
        .catch(() => {})
    }
    load()
    const t = setInterval(load, 30000)
    return () => { active = false; clearInterval(t) }
  }, [user])

  /**
   * Icons and badges live here; which rows exist and what each one requires
   * lives in @/lib/permissions, shared with the route guard in the dashboard
   * layout. Keeping one list means a row can never be visible for a page the
   * guard would refuse — or hidden for one it would allow.
   */
  const icons: Record<string, LucideIcon> = {
    "/dashboard": LayoutDashboardIcon,
    "/patients": StethoscopeIcon,
    "/leads": UsersIcon,
    "/my-leads": HeadphonesIcon,
    "/campaigns": MegaphoneIcon,
    "/crm-desk": HeartHandshakeIcon,
    "/crm": ContactRoundIcon,
    "/analytics": BarChart3Icon,
    "/analytics/medical": ActivityIcon,
    "/financial": BanknoteIcon,
    "/financial/patients": CrownIcon,
    "/tiers": GemIcon,
    "/reports/doctors": FileSpreadsheetIcon,
    "/reports/referrals": GitBranchIcon,
    "/sync": RefreshCwIcon,
    "/settings/external-migration": DatabaseIcon,
    "/settings/leads-log": ClipboardListIcon,
    "/settings/leads-bank": DatabaseIcon,
    "/settings/webhook-logs": WebhookIcon,
    "/settings/users": UserCogIcon,
    "/settings/login-log": ShieldIcon,
    "/settings/telephony": PhoneIcon,
    "/settings/display": EyeOffIcon,
  }

  const badges: Record<string, { badge?: number; badgeTone?: NavItem["badgeTone"] }> = {
    "/leads": { badge: counts?.newUnassigned },
    "/my-leads": { badge: counts?.myOverdueFollowUps, badgeTone: "warning" },
  }

  // Rows without an icon are pages that exist but are not meant to appear in
  // the sidebar (drill-down views), so they are skipped rather than defaulted.
  const rowsFor = (group: SectionDef["group"]): NavItem[] =>
    SECTIONS.filter((s) => s.group === group && s.anyOf.some(hasPermission) && icons[s.url]).map(
      (s) => ({ title: s.title, url: s.url, icon: icons[s.url]!, ...badges[s.url] }),
    )

  const navItems = rowsFor("main")
  const analysisItems = rowsFor("analysis")
  const settingsItems = rowsFor("settings")

  /**
   * Only the most specific matching item is active.
   *
   * A plain prefix test lit up both `/financial` and `/financial/patients` at
   * once (and likewise `/analytics` with its children), so two rows looked
   * selected. Picking the longest matching url leaves exactly one.
   */
  const activeUrl =
    [...navItems, ...analysisItems, ...settingsItems]
      .map((i) => i.url)
      .filter((url) => pathname === url || pathname.startsWith(url + "/"))
      .sort((a, b) => b.length - a.length)[0] ?? null

  const isActive = (url: string) => url === activeUrl

  /**
   * One place for nav row styling so the three groups cannot drift apart.
   * The active row gets a start-edge marker and a slight lift, which reads as
   * "selected" far faster than a background tint alone.
   */
  const navButtonClass = (url: string) =>
    [
      "h-11 gap-3 rounded-lg px-3 text-[0.95rem] transition-all",
      "hover:bg-sidebar-accent/60",
      "group-data-[collapsible=icon]:!h-11 group-data-[collapsible=icon]:!px-0",
      isActive(url)
        ? "relative bg-sidebar-accent font-semibold text-sidebar-accent-foreground shadow-sm before:absolute before:inset-y-2 before:start-0 before:w-1 before:rounded-full before:bg-primary"
        : "text-sidebar-foreground/80",
    ].join(" ")

  if (!user) return null

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <ClinicBrand />
      </SidebarHeader>
      <SidebarContent>
        {navItems.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-[0.7rem] font-semibold tracking-wide text-sidebar-foreground/50">منو اصلی</SidebarGroupLabel>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    tooltip={item.title}
                    render={<Link href={item.url} />}
                    data-active={isActive(item.url)}
                    className={navButtonClass(item.url)}
                  >
                    <item.icon className="size-[1.15rem] shrink-0" />
                    <span className="flex-1">{item.title}</span>
                    {item.badge ? (
                      <span
                        className={
                          "ms-auto inline-flex items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none " +
                          (item.badgeTone === "warning"
                            ? "bg-amber-500 text-white"
                            : "bg-violet-600 text-white")
                        }
                      >
                        {toPersianNum(item.badge)}
                      </span>
                    ) : null}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        )}
        {analysisItems.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-[0.7rem] font-semibold tracking-wide text-sidebar-foreground/50">تحلیل‌ها</SidebarGroupLabel>
            <SidebarMenu>
              {analysisItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    tooltip={item.title}
                    render={<Link href={item.url} />}
                    data-active={isActive(item.url)}
                    className={navButtonClass(item.url)}
                  >
                    <item.icon className="size-[1.15rem] shrink-0" />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        )}
        {settingsItems.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-[0.7rem] font-semibold tracking-wide text-sidebar-foreground/50">تنظیمات</SidebarGroupLabel>
            <SidebarMenu>
              {settingsItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    tooltip={item.title}
                    render={<Link href={item.url} />}
                    data-active={isActive(item.url)}
                    className={navButtonClass(item.url)}
                  >
                    <item.icon className="size-[1.15rem] shrink-0" />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        )}

        <SidebarGroup>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip={theme === "dark" ? "حالت روشن" : "حالت تاریک"} onClick={toggle}>
                {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
                <span>{theme === "dark" ? "حالت روشن" : "حالت تاریک"}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={{
          name: user.fullName || user.email,
          email: user.email,
          avatar: "",
        }} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
