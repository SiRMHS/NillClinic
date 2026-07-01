"use client"

import { BrainCircuit } from "lucide-react"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

export function ClinicBrand() {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton size="lg" className="cursor-default hover:bg-transparent">
          <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
            <BrainCircuit className="size-4 text-yellow-600 dark:text-yellow-400" />
          </div>
          <div className="grid flex-1 text-start text-sm leading-tight">
            <span className="truncate font-medium">کلینیک جردن</span>
            <span className="truncate text-xs text-muted-foreground">داشبورد مدیریتی</span>
          </div>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
