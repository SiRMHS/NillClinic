"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { apiDownload, apiFetch } from "@/lib/api-client"
import {
  formatCount,
  formatPercent,
  formatRial,
  formatRialExact,
  toPersianNum,
} from "@/lib/format"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import { DateRangeFilter, type DateRange } from "@/components/ui/date-range-filter"
import { SortableHead, type SortDirection } from "@/components/ui/sortable-table"
import {
  PATIENT_TIER_LABELS,
  PATIENT_TIER_ORDER,
  type PatientTier,
} from "@/components/tier-badge"
import { Download, Info, Stethoscope } from "lucide-react"
import { toast } from "sonner"
import { useAuth } from "@/stores/auth.store"

interface DoctorRow {
  doctorName: string
  receptionCount: number
  lineCount: number
  patientCount: number
  newPatientCount: number
  received: number
  discount: number
  outstanding: number
  averagePerPatient: number
  averagePerReception: number
  consultationCount: number
  treatmentCount: number
  revenueShare: number
}

interface Report {
  rows: DoctorRow[]
  totals: {
    doctorCount: number
    received: number
    discount: number
    outstanding: number
    patientCount: number
    receptionCount: number
    lineCount: number
  }
  sharedLineCount: number
  generatedAt: string
}

interface DoctorOption {
  name: string
  lineCount: number
  patientCount: number
  received: number
}

type SortKey =
  | "received" | "patients" | "receptions" | "lines"
  | "discount" | "outstanding" | "avgPerPatient" | "newPatients" | "name"

type ServiceKind = "all" | "consultation" | "treatment"

const SERVICE_KIND_LABELS: Record<ServiceKind, string> = {
  all: "همه خدمات",
  consultation: "فقط مشاوره",
  treatment: "فقط درمان",
}

export default function DoctorReportPage() {
  const [report, setReport] = useState<Report | null>(null)
  const [options, setOptions] = useState<DoctorOption[]>([])
  const [selectedDoctors, setSelectedDoctors] = useState<string[]>([])
  const [range, setRange] = useState<DateRange>({ from: "", to: "" })
  const [serviceKind, setServiceKind] = useState<ServiceKind>("all")
  const [tier, setTier] = useState<PatientTier | "">("")
  const [sort, setSort] = useState<{ key: SortKey; direction: SortDirection }>({
    key: "received",
    direction: "desc",
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  // Downloading is its own key: a role may read the report on screen
  // without being allowed to carry the numbers out of the system.
  // Subscribes to `user` rather than to `hasPermission`: the function
  // identity never changes, so selecting it would not re-render once
  // /api/auth/me resolves and the button would stay hidden.
  const canExport = useAuth(
    (s) => s.user?.permissions.includes("*") || s.user?.permissions.includes("reports.export"),
  ) ?? false

  const query = useMemo(() => {
    const qs = new URLSearchParams({ sort: sort.key, direction: sort.direction, limit: "100" })
    if (range.from) qs.set("from", range.from)
    if (range.to) qs.set("to", range.to)
    if (serviceKind !== "all") qs.set("serviceKind", serviceKind)
    if (tier) qs.set("tier", tier)
    if (selectedDoctors.length) qs.set("doctors", selectedDoctors.join(","))
    return qs
  }, [range.from, range.to, serviceKind, tier, selectedDoctors, sort.key, sort.direction])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const rangeQs = new URLSearchParams()
      if (range.from) rangeQs.set("from", range.from)
      if (range.to) rangeQs.set("to", range.to)
      const [rep, docs] = await Promise.all([
        apiFetch<Report>(`/api/reports/doctors/report?${query}`),
        apiFetch<DoctorOption[]>(`/api/reports/doctors?${rangeQs}`),
      ])
      setReport(rep)
      setOptions(docs)
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطا در دریافت گزارش پزشکان")
    } finally {
      setLoading(false)
    }
  }, [query, range.from, range.to])

  useEffect(() => {
    void load()
  }, [load])

  const onSort = (key: SortKey, defaultDirection: SortDirection = "desc") => {
    setSort((s) =>
      s.key === key
        ? { key, direction: s.direction === "asc" ? "desc" : "asc" }
        : { key, direction: defaultDirection },
    )
  }

  const toggleDoctor = (name: string) => {
    setSelectedDoctors((c) => (c.includes(name) ? c.filter((d) => d !== name) : [...c, name]))
  }

  const exportCsv = async () => {
    setExporting(true)
    try {
      await apiDownload(`/api/reports/doctors/report/export?${query}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "خروجی گرفتن ناموفق بود")
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6" dir="rtl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">گزارش پزشکان</h1>
          <p className="text-sm text-muted-foreground">
            عملکرد هر پزشک بر پایه خدمات ثبت‌شده در پذیرش‌ها، در بازه تاریخی دلخواه
          </p>
        </div>
        {canExport && (
        <Button variant="outline" size="sm" onClick={() => void exportCsv()} disabled={exporting}>
          <Download className="size-4" />
          خروجی اکسل
        </Button>
        )}
      </div>

      {error ? (
        <Card>
          <CardContent className="py-6 text-center text-sm text-rose-600 dark:text-rose-400">
            {error}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">فیلترها</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <DateRangeFilter value={range} onChange={setRange} />

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">نوع خدمت:</span>
            {(Object.keys(SERVICE_KIND_LABELS) as ServiceKind[]).map((k) => (
              <Chip key={k} active={serviceKind === k} onClick={() => setServiceKind(k)}>
                {SERVICE_KIND_LABELS[k]}
              </Chip>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">رتبه بیمار:</span>
            <Chip active={tier === ""} onClick={() => setTier("")}>
              همه
            </Chip>
            {PATIENT_TIER_ORDER.map((t) => (
              <Chip key={t} active={tier === t} onClick={() => setTier(tier === t ? "" : t)}>
                {PATIENT_TIER_LABELS[t]}
              </Chip>
            ))}
          </div>

          {options.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">پزشک:</span>
              <Chip active={selectedDoctors.length === 0} onClick={() => setSelectedDoctors([])}>
                همه ({toPersianNum(options.length)})
              </Chip>
              {options.slice(0, 14).map((d) => (
                <Chip
                  key={d.name}
                  active={selectedDoctors.includes(d.name)}
                  onClick={() => toggleDoctor(d.name)}
                >
                  {d.name}
                </Chip>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {report ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="پزشک" value={formatCount(report.totals.doctorCount)} icon={<Stethoscope className="size-4" />} />
          <Stat
            label="درآمد کل بازه"
            value={`${formatRial(report.totals.received)} ریال`}
            title={formatRialExact(report.totals.received)}
          />
          <Stat label="بیمار یکتا" value={formatCount(report.totals.patientCount)} />
          <Stat label="پذیرش" value={formatCount(report.totals.receptionCount)} />
        </div>
      ) : null}

      {report && report.sharedLineCount > 0 ? (
        <Card className="border-sky-300 bg-sky-50 dark:border-sky-900 dark:bg-sky-950/30">
          <CardContent className="flex items-start gap-2 py-3 text-xs">
            <Info className="mt-0.5 size-4 shrink-0 text-sky-600 dark:text-sky-400" />
            <span>
              {formatCount(report.sharedLineCount)} خدمت در این بازه به نام دو پزشک ثبت شده و برای
              هر دو شمارش می‌شود. به همین دلیل جمع ستون درآمد پزشکان کمی بیشتر از «درآمد کل بازه»
              است.
            </span>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">عملکرد پزشکان</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          {loading ? (
            <div className="space-y-2 px-6">
              {Array.from({ length: 8 }, (_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : !report || report.rows.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              داده‌ای با این فیلترها یافت نشد.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableHead
                      label="پزشک"
                      sortKey="name"
                      sort={sort}
                      onSort={onSort}
                      defaultDirection="asc"
                    />
                    <SortableHead
                      label="درآمد"
                      sortKey="received"
                      sort={sort}
                      onSort={onSort}
                    />
                    <SortableHead
                      label="بیمار"
                      sortKey="patients"
                      sort={sort}
                      onSort={onSort}
                    />
                    <SortableHead
                      label="بیمار جدید"
                      sortKey="newPatients"
                      sort={sort}
                      onSort={onSort}
                    />
                    <SortableHead
                      label="پذیرش"
                      sortKey="receptions"
                      sort={sort}
                      onSort={onSort}
                    />
                    <TableHead className="text-right">مشاوره / درمان</TableHead>
                    <SortableHead
                      label="میانگین هر بیمار"
                      sortKey="avgPerPatient"
                      sort={sort}
                      onSort={onSort}
                    />
                    <SortableHead
                      label="تخفیف"
                      sortKey="discount"
                      sort={sort}
                      onSort={onSort}
                    />
                    <SortableHead
                      label="مانده"
                      sortKey="outstanding"
                      sort={sort}
                      onSort={onSort}
                    />
                    <TableHead className="text-right">سهم</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.rows.map((r) => (
                    <TableRow key={r.doctorName}>
                      <TableCell className="whitespace-nowrap font-medium">{r.doctorName}</TableCell>
                      <TableCell
                        className="whitespace-nowrap tabular-nums"
                        title={formatRialExact(r.received)}
                      >
                        {formatRial(r.received)}
                      </TableCell>
                      <TableCell className="tabular-nums">{formatCount(r.patientCount)}</TableCell>
                      <TableCell className="tabular-nums">
                        {formatCount(r.newPatientCount)}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {formatCount(r.receptionCount)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs tabular-nums">
                        <span className="text-sky-700 dark:text-sky-400">
                          {formatCount(r.consultationCount)}
                        </span>
                        {" / "}
                        <span>{formatCount(r.treatmentCount)}</span>
                      </TableCell>
                      <TableCell
                        className="whitespace-nowrap tabular-nums"
                        title={formatRialExact(r.averagePerPatient)}
                      >
                        {formatRial(r.averagePerPatient)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                        {formatRial(r.discount)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                        {formatRial(r.outstanding)}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {formatPercent(r.revenueShare)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border px-2.5 py-1 text-xs transition ${
        active ? "border-primary bg-primary/10 font-medium" : "hover:border-primary/50"
      }`}
    >
      {children}
    </button>
  )
}

function Stat({
  label,
  value,
  icon,
  title,
}: {
  label: string
  value: string
  icon?: React.ReactNode
  title?: string
}) {
  return (
    <div className="rounded-lg border p-3" title={title}>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-xl font-bold tabular-nums">{value}</div>
    </div>
  )
}
