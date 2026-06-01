"use client"

import { useEffect, useState } from "react"
import { ChartAreaInteractive } from "@/components/chart-area-interactive"
import { DataTable } from "@/components/data-table"
import { SectionCards } from "@/components/section-cards"
import { apiFetch } from "@/lib/api-client"

interface Lead {
  id: string
  source: string
  status: string
  fullName: string | null
  mobile: string | null
  createdAt: string
}

export default function Page() {
  const [leads, setLeads] = useState<Lead[]>([])

  useEffect(() => {
    apiFetch<Lead[]>("/api/leads")
      .then(setLeads)
      .catch(() => {})
  }, [])

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <SectionCards />
      <ChartAreaInteractive />
      <div>
        <h2 className="text-sm font-semibold text-foreground mb-3">لیدهای اخیر</h2>
        <DataTable data={leads} />
      </div>
    </div>
  )
}
