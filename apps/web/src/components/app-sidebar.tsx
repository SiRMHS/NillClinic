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
  RefreshCwIcon, StethoscopeIcon, DatabaseIcon,
  ClipboardListIcon, WebhookIcon, UserCogIcon,
  Activity, HeadphonesIcon, MegaphoneIcon,
  ContactRoundIcon,
} from "lucide-react"

import { useAuth } from "@/stores/auth.store"
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

  const navItems: NavItem[] = [
    ...(hasPermission("dashboard") ? [{ title: "داشبورد", url: "/dashboard", icon: LayoutDashboardIcon }] : []),
    ...(hasPermission("patients") || hasPermission("patients.view") ? [{ title: "بیماران", url: "/patients", icon: StethoscopeIcon }] : []),
    ...(hasPermission("leads") ? [{ title: "لیدها", url: "/leads", icon: UsersIcon, badge: counts?.newUnassigned }] : []),
    ...(hasPermission("leads") ? [{ title: "لیدهای من", url: "/my-leads", icon: HeadphonesIcon, badge: counts?.myOverdueFollowUps, badgeTone: "warning" as const }] : []),
    ...(hasPermission("leads") ? [{ title: "کمپین‌ها", url: "/campaigns", icon: MegaphoneIcon }] : []),
  ]

  const analysisItems: NavItem[] = [
    ...(hasPermission("analytics") ? [{ title: "CRM", url: "/crm", icon: ContactRoundIcon }] : []),
    ...(hasPermission("analytics") ? [{ title: "تحلیل‌ها", url: "/analytics", icon: BarChart3Icon }] : []),
    ...(hasPermission("analytics") ? [{ title: "تحلیل‌های پزشکی", url: "/analytics/medical", icon: Activity }] : []),
  ]

  const settingsItems: NavItem[] = [
    ...(hasPermission("sync") ? [{ title: "سینک CRM", url: "/sync", icon: RefreshCwIcon }] : []),
    ...(hasPermission("settings") ? [
      { title: "ورودی خارجی", url: "/settings/external-migration", icon: DatabaseIcon },
      { title: "لاگ ورودی‌ها", url: "/settings/leads-log", icon: ClipboardListIcon },
      { title: "بانک لیدها", url: "/settings/leads-bank", icon: DatabaseIcon },
      { title: "لاگ وب‌هوک", url: "/settings/webhook-logs", icon: WebhookIcon },
    ] : []),
    ...(hasPermission("settings.users") || hasPermission("settings.roles")
      ? [{ title: "کاربران و نقش‌ها", url: "/settings/users", icon: UserCogIcon }]
      : []),
  ]

  const isActive = (url: string) => pathname === url || pathname.startsWith(url + "/")

  if (!user) return null

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <ClinicBrand />
      </SidebarHeader>
      <SidebarContent>
        {navItems.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>منو اصلی</SidebarGroupLabel>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    tooltip={item.title}
                    render={<Link href={item.url} />}
                    data-active={isActive(item.url)}
                    className={isActive(item.url) ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium" : ""}
                  >
                    <item.icon className="size-4" />
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
            <SidebarGroupLabel>تحلیل‌ها</SidebarGroupLabel>
            <SidebarMenu>
              {analysisItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    tooltip={item.title}
                    render={<Link href={item.url} />}
                    data-active={isActive(item.url)}
                    className={isActive(item.url) ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium" : ""}
                  >
                    <item.icon className="size-4" />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        )}
        {settingsItems.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>تنظیمات</SidebarGroupLabel>
            <SidebarMenu>
              {settingsItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    tooltip={item.title}
                    render={<Link href={item.url} />}
                    data-active={isActive(item.url)}
                    className={isActive(item.url) ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium" : ""}
                  >
                    <item.icon className="size-4" />
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
