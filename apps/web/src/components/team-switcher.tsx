"use client"

import * as React from "react"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { ChevronsUpDownIcon, PlusIcon, Flame, SettingsIcon, UsersIcon } from "lucide-react"
import { apiFetch } from "@/lib/api-client"
import { useAuth } from "@/stores/auth.store"

interface ApiTeam {
  id: string
  name: string
  label: string
  description: string | null
  memberCount: number
}

export function TeamSwitcher({
  teams,
}: {
  teams: {
    name: string
    logo: React.ReactNode
    plan: string
  }[]
}) {
  const { isMobile } = useSidebar()
  const router = useRouter()
  const { hasPermission } = useAuth()
  const [apiTeams, setApiTeams] = useState<ApiTeam[]>([])
  const [activeTeam, setActiveTeam] = React.useState(teams[0])

  useEffect(() => {
    if (hasPermission("settings") || hasPermission("settings.users") || hasPermission("settings.roles")) {
      apiFetch<ApiTeam[]>("/api/admin/teams").then(setApiTeams).catch(() => {})
    }
  }, [hasPermission])

  if (!activeTeam) return null

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                className="data-open:bg-sidebar-accent data-open:text-sidebar-accent-foreground"
              />
            }
          >
            <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
              {activeTeam.logo}
            </div>
            <div className="grid flex-1 text-start text-sm leading-tight">
              <span className="truncate font-medium">{activeTeam.name}</span>
              <span className="truncate text-xs">{activeTeam.plan}</span>
            </div>
            <ChevronsUpDownIcon className="ms-auto" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-fit min-w-48"
            align="start"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                تیم‌ها
              </DropdownMenuLabel>
              {teams.map((team, index) => (
                <DropdownMenuItem
                  key={team.name}
                  onClick={() => setActiveTeam(team)}
                  className="gap-2 p-2"
                >
                  <div className="flex size-6 items-center justify-center rounded-md border">
                    {team.logo}
                  </div>
                  <div className="flex flex-col">
                    <span>{team.name}</span>
                    <span className="text-xs text-muted-foreground">{team.plan}</span>
                  </div>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>

            {apiTeams.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="text-xs text-muted-foreground">
                    تیم‌های سیستم ({apiTeams.length})
                  </DropdownMenuLabel>
                  {apiTeams.map((team) => (
                    <DropdownMenuItem
                      key={team.id}
                      onClick={() => router.push(`/settings/teams`)}
                      className="gap-2 p-2"
                    >
                      <div className="flex size-6 items-center justify-center rounded-md border bg-transparent">
                        <UsersIcon className="size-3.5 text-muted-foreground" />
                      </div>
                      <div className="flex flex-col">
                        <span>{team.label}</span>
                        <span className="text-xs text-muted-foreground">{team.memberCount} عضو</span>
                      </div>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              </>
            )}

            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem
                className="gap-2 p-2"
                onClick={() => router.push("/settings/teams")}
              >
                <div className="flex size-6 items-center justify-center rounded-md border bg-transparent">
                  <SettingsIcon className="size-3.5" />
                </div>
                <span>مدیریت تیم‌ها</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="gap-2 p-2"
                onClick={() => router.push("/settings/users")}
              >
                <div className="flex size-6 items-center justify-center rounded-md border bg-transparent">
                  <PlusIcon className="size-3.5" />
                </div>
                <span>افزودن کاربر جدید</span>
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
