"use client"

import * as React from "react"
import { NavUser } from "@/components/nav-user"
import { TeamSwitcher } from "@/components/team-switcher"
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
  ClipboardListIcon, WebhookIcon, UserCogIcon, Building2Icon,BrainCircuit,
  Activity,
} from "lucide-react"

import { useAuth } from "@/stores/auth.store"

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname()
  const { theme, toggle } = useTheme()
  const { user, hasPermission } = useAuth()

  const navItems = [
    ...(hasPermission("dashboard") ? [{ title: "داشبورد", url: "/dashboard", icon: LayoutDashboardIcon }] : []),
    ...(hasPermission("patients") || hasPermission("patients.view") ? [{ title: "بیماران", url: "/patients", icon: StethoscopeIcon }] : []),
    ...(hasPermission("leads") ? [{ title: "لیدها", url: "/leads", icon: UsersIcon }] : []),
  ]

  const analysisItems = [
    ...(hasPermission("analytics") ? [{ title: "تحلیل‌ها", url: "/analytics", icon: BarChart3Icon }] : []),
    ...(hasPermission("analytics") ? [{ title: "تحلیل‌های پزشکی", url: "/analytics/medical", icon: Activity }] : []),
  ]

  const settingsItems = [
    ...(hasPermission("sync") ? [{ title: "سینک CRM", url: "/sync", icon: RefreshCwIcon }] : []),
    ...(hasPermission("settings") ? [
      { title: "ورودی خارجی", url: "/settings/external-migration", icon: DatabaseIcon },
      { title: "لاگ ورودی‌ها", url: "/settings/leads-log", icon: ClipboardListIcon },
      { title: "لاگ وب‌هوک", url: "/settings/webhook-logs", icon: WebhookIcon },
    ] : []),
    ...(hasPermission("settings.users") ? [{ title: "کاربران", url: "/settings/users", icon: UserCogIcon }] : []),
    ...(hasPermission("settings.roles") ? [{ title: "تیم‌ها", url: "/settings/teams", icon: Building2Icon }] : []),
  ]

  const isActive = (url: string) => pathname === url || pathname.startsWith(url + "/")

  if (!user) return null

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <TeamSwitcher teams={[
          {
            name: "کلینیک جردن",
            logo: <BrainCircuit className="text-yellow-600 dark:text-yellow-400" />,
            plan: "داشبورد مدیریتی",
          },
        ]} />
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
                    <span>{item.title}</span>
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
