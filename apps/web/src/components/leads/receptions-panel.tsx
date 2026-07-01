"use client"

import { useCallback, useEffect, useState } from "react"
import { apiFetch } from "@/lib/api-client"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { formatJalaliDisplay, startOfJalaliYear, todayJalali } from "@/lib/jalali-date"
import { JalaliDatePicker } from "@/components/ui/jalali-date-picker"
import { Calendar, Search, User, Stethoscope, Hash, AlertCircle } from "lucide-react"
import { toPersianNum } from "@/components/leads/constants"
import { toast } from "sonner"

interface ReceptionDetail {
  secName: string
  srvName: string
  receptionPersonnelName?: string | null
}

interface Reception {
  id: string
  externalId: number
  receptionNo: number
  receptionDate: string
  treatmentItemNames: string | null
  treatmentItemNamesList: string[] | unknown
  userName: string
  isReturn: boolean
  detailsJson: ReceptionDetail[] | unknown
  patientExternalCode?: number
  patient: {
    id: string
    fullName: string | null
    externalCode: number
    mobile: string | null
  } | null
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === "string")
}

function asDetails(value: unknown): ReceptionDetail[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is ReceptionDetail => v != null && typeof v === "object" && "srvName" in v)
}

export function ReceptionsPanel() {
  const [receptions, setReceptions] = useState<Reception[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [fromDate, setFromDate] = useState(startOfJalaliYear)
  const [toDate, setToDate] = useState(todayJalali)
  const [error, setError] = useState<string | null>(null)

  const fetchReceptions = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        limit: "100",
        fromDate,
        toDate,
      })
      if (search.trim()) params.set("search", search.trim())
      const data = await apiFetch<Reception[]>(`/api/receptions?${params}`)
      setReceptions(data)
    } catch (e) {
      const msg = e instanceof Error ? e.message : "خطا در دریافت نوبت‌های پذیرش"
      setError(msg)
      setReceptions([])
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }, [search, fromDate, toDate])

  useEffect(() => {
    const timer = setTimeout(fetchReceptions, 300)
    return () => clearTimeout(timer)
  }, [fetchReceptions])

  if (loading && receptions.length === 0) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Calendar className="size-4 text-violet-600" />
        نوبت‌های پذیرش (GetReceptions)
      </div>

      <div className="grid gap-3 sm:grid-cols-2 max-w-lg">
        <JalaliDatePicker label="از تاریخ" value={fromDate} onChange={setFromDate} />
        <JalaliDatePicker label="تا تاریخ" value={toDate} onChange={setToDate} />
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          placeholder="جستجو بیمار، خدمت، اپراتور..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pr-9 h-9"
        />
      </div>

      {error && (
        <Card className="border-rose-200 bg-rose-50 dark:bg-rose-950/20">
          <CardContent className="py-4 flex items-center gap-2 text-sm text-rose-700 dark:text-rose-300">
            <AlertCircle className="size-4 shrink-0" />
            {error}
          </CardContent>
        </Card>
      )}

      {receptions.length === 0 && !error ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            نوبتی یافت نشد
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {receptions.map((r) => {
            const items = asStringList(r.treatmentItemNamesList)
            const details = asDetails(r.detailsJson)
            const displayItems = items.length ? items : (r.treatmentItemNames ? [r.treatmentItemNames] : [])

            return (
              <Card key={r.id} className="overflow-hidden hover:shadow-sm transition-shadow">
                <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="size-10 rounded-xl bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center shrink-0">
                      <Calendar className="size-5 text-violet-600" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold">
                          {r.patient?.fullName || `بیمار ${toPersianNum(r.patient?.externalCode ?? r.patientExternalCode ?? "")}`}
                        </span>
                        {r.isReturn && (
                          <Badge variant="outline" className="text-[10px]">مراجعه مجدد</Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap gap-x-2">
                        <span className="flex items-center gap-1">
                          <Hash className="size-3" />
                          {toPersianNum(r.receptionNo)}
                        </span>
                        {r.patient?.mobile && <span dir="ltr">{r.patient.mobile}</span>}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 border-0 font-normal">
                      {formatJalaliDisplay(r.receptionDate)}
                    </Badge>
                    {displayItems.map((item) => (
                      <Badge key={item} variant="secondary" className="font-normal">
                        <Stethoscope className="size-3 me-1" />
                        {item}
                      </Badge>
                    ))}
                    {details.slice(0, 2).map((d, i) => (
                      <Badge key={`${d.srvName}-${i}`} variant="outline" className="font-normal">
                        {d.srvName}
                      </Badge>
                    ))}
                    <span className="text-muted-foreground flex items-center gap-1">
                      <User className="size-3" />
                      {r.userName}
                    </span>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
