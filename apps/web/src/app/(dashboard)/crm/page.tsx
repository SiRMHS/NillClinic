"use client"

import { useCallback, useEffect, useState } from "react"
import { apiDownload, apiFetch } from "@/lib/api-client"
import { useCrmMasking } from "@/stores/display.store"
import { MASKED_FIGURE, formatCount, formatPercent, formatRial, formatRialExact, toPersianNum } from "@/lib/format"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Skeleton } from "@/components/ui/skeleton"
import { DateRangeFilter } from "@/components/ui/date-range-filter"
import { SortableHead, useSortableRows } from "@/components/ui/sortable-table"
import { PatientDetailDialog } from "@/components/patient-detail-dialog"
import { toast } from "sonner"
import {
  AlertTriangle, ArrowDownRight, ArrowUpRight, Download, PhoneCall, RefreshCw,
  Repeat, Stethoscope, TrendingUp, Users,
} from "lucide-react"

interface ServicePopularity {
  serviceExternalId: number | null
  serviceName: string
  sectionName: string | null
  kind: "consultation" | "procedure"
  receptionCount: number
  patientCount: number
  revenue: number
  averagePrice: number
  share: number
}
interface ConversionSummary {
  consultedPatients: number
  convertedPatients: number
  conversionRate: number
  medianDaysToConvert: number | null
  consultationLines: number
  procedureLines: number
  convertedRevenue: number
  revenuePerConverted: number
}
interface ConversionByType {
  consultationName: string
  consultedPatients: number
  convertedPatients: number
  conversionRate: number
  revenueAfter: number
}
interface DoctorRanking {
  personnelName: string
  revenue: number
  patientCount: number
  receptionCount: number
  procedureLines: number
  consultationLines: number
  averageTicket: number
  repeatPatientRate: number
  conversionRate: number | null
  revenueShare: number
}
interface RetentionSummary {
  totalPatients: number
  returningPatients: number
  returnRate: number
  averageVisitsPerPatient: number
  medianDaysBetweenVisits: number | null
  singleVisitPatients: number
}
interface VisitFrequencyBucket {
  visits: string
  patientCount: number
  revenue: number
}
interface FollowUpCandidate {
  patientExternalCode: number
  patientId: string | null
  fullName: string | null
  mobile: string | null
  lastVisitDate: string | null
  daysSinceLastVisit: number
  visitCount: number
  totalReceived: number
  lastServices: string | null
}
interface Coverage {
  oldestReceptionDate: string | null
  newestReceptionDate: string | null
  receptionCount: number
  lineCount: number
  syncComplete: boolean
  syncCursorDate: string | null
}

function Stat({
  label, value, hint, icon, tone,
}: {
  label: string
  value: string
  hint?: string
  icon?: React.ReactNode
  tone?: "positive" | "warning" | "danger"
}) {
  const toneClass =
    tone === "positive" ? "text-emerald-600 dark:text-emerald-400"
    : tone === "warning" ? "text-amber-600 dark:text-amber-400"
    : tone === "danger" ? "text-rose-600 dark:text-rose-400"
    : ""
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        {icon ? <span className="text-muted-foreground">{icon}</span> : null}
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold tabular-nums ${toneClass}`}>{value}</div>
        {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  )
}

/** Inline proportion bar — reads faster than a number alone in a dense table. */
/**
 * Money and rate formatting for this page, honouring the CRM display switches.
 *
 * The site-wide switch is already handled inside `formatRial` itself, and the
 * API strips those amounts before they arrive. The CRM-scoped switches cannot
 * be: these endpoints also back the dashboard and the patient dialog, so they
 * are applied on the page that the switch actually names.
 */
function useCrmFormat() {
  const masked = useCrmMasking()
  return {
    masked,
    rial: (value: number | null | undefined) =>
      masked.amounts ? MASKED_FIGURE : formatRial(value ?? 0),
    rialExact: (value: number | null | undefined) =>
      masked.amounts ? MASKED_FIGURE : formatRialExact(value ?? 0),
    rate: (value: number | null | undefined, digits = 1) =>
      masked.rates ? MASKED_FIGURE : value === null || value === undefined ? "—" : formatPercent(value, digits),
  }
}

/** A RateBar that reads «———» instead of drawing a bar when rates are hidden. */
function MaskableRate({
  value,
  hidden,
  tone,
}: {
  value: number | null
  hidden: boolean
  tone?: "emerald" | "amber"
}) {
  if (hidden) return <span className="text-muted-foreground">{MASKED_FIGURE}</span>
  if (value === null) return <span className="text-muted-foreground">—</span>
  return <RateBar value={value} tone={tone} />
}

function RateBar({ value, tone = "emerald" }: { value: number; tone?: "emerald" | "amber" }) {
  const pct = Math.max(0, Math.min(1, value)) * 100
  return (
    // inline-flex, not flex: a block-level flex box positions itself and
    // ignores the cell's text alignment, so the bar drifted out from under its
    // header (which is an inline-flex button obeying the same `text-left`).
    <span className="inline-flex items-center gap-2 align-middle">
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
        <span
          className={`block h-full ${tone === "amber" ? "bg-amber-500" : "bg-emerald-500"}`}
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="w-12 text-left tabular-nums">{formatPercent(value, 0)}</span>
    </span>
  )
}

export default function VisitorAnalyticsPage() {
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")

  const [coverage, setCoverage] = useState<Coverage | null>(null)
  const [services, setServices] = useState<{ top: ServicePopularity[]; bottom: ServicePopularity[] } | null>(null)
  const [conversion, setConversion] = useState<{ summary: ConversionSummary; byType: ConversionByType[] } | null>(null)
  const [doctors, setDoctors] = useState<DoctorRanking[]>([])
  const [retention, setRetention] = useState<{ summary: RetentionSummary; frequency: VisitFrequencyBucket[] } | null>(null)
  const [followUp, setFollowUp] = useState<FollowUpCandidate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const qs = new URLSearchParams()
    if (from) qs.set("from", from)
    if (to) qs.set("to", to)
    const range = qs.toString() ? `?${qs.toString()}` : ""
    const withParam = (extra: string) => `${range ? `${range}&` : "?"}${extra}`

    try {
      const [cov, svc, conv, docs, ret, fu] = await Promise.all([
        apiFetch<Coverage>("/api/visitors/coverage"),
        apiFetch<{ top: ServicePopularity[]; bottom: ServicePopularity[] }>(
          `/api/visitors/services${withParam("limit=10&kind=procedure")}`,
        ),
        apiFetch<{ summary: ConversionSummary; byType: ConversionByType[] }>(
          `/api/visitors/conversion${range}`,
        ),
        apiFetch<DoctorRanking[]>(`/api/visitors/doctors${withParam("limit=30")}`),
        apiFetch<{ summary: RetentionSummary; frequency: VisitFrequencyBucket[] }>(
          `/api/visitors/retention${range}`,
        ),
        apiFetch<{ asOf: string; candidates: FollowUpCandidate[] }>(
          "/api/visitors/follow-up?minDays=180&limit=100",
        ),
      ])
      setCoverage(cov)
      setServices(svc)
      setConversion(conv)
      setDoctors(docs)
      setRetention(ret)
      setFollowUp(fu.candidates)
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطا در دریافت تحلیل مراجعین")
    } finally {
      setLoading(false)
    }
  }, [from, to])

  useEffect(() => {
    void load()
  }, [load])

  const docSort = useSortableRows(
    doctors,
    {
      name: (r) => r.personnelName,
      revenue: (r) => r.revenue,
      share: (r) => r.revenueShare,
      patients: (r) => r.patientCount,
      avg: (r) => r.averageTicket,
      repeat: (r) => r.repeatPatientRate,
      conversion: (r) => r.conversionRate,
    },
    { key: "revenue", direction: "desc" },
  )
  const convSort = useSortableRows(
    conversion?.byType ?? [],
    {
      name: (r) => r.consultationName,
      consulted: (r) => r.consultedPatients,
      converted: (r) => r.convertedPatients,
      rate: (r) => r.conversionRate,
      revenue: (r) => r.revenueAfter,
    },
    { key: "consulted", direction: "desc" },
  )
  const fuSort = useSortableRows(
    followUp,
    {
      name: (r) => r.fullName,
      days: (r) => r.daysSinceLastVisit,
      visits: (r) => r.visitCount,
      value: (r) => r.totalReceived,
    },
    { key: "value", direction: "desc" },
  )

  const conv = conversion?.summary
  const ret = retention?.summary
  const fmt = useCrmFormat()

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6" dir="rtl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">تحلیل مراجعین</h1>
          <p className="text-sm text-muted-foreground">
            بر پایه پذیرش‌های واقعی — خدمات، نرخ تبدیل، عملکرد پزشکان و بازگشت بیمار
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <DateRangeFilter
            value={{ from, to }}
            onChange={(r) => {
              setFrom(r.from)
              setTo(r.to)
            }}
          />
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
            بازخوانی
          </Button>
        </div>
      </div>

      {error ? (
        <Card>
          <CardContent className="py-6 text-center text-sm text-rose-600 dark:text-rose-400">{error}</CardContent>
        </Card>
      ) : null}

      {coverage && !coverage.syncComplete ? (
        <Card className="border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40">
          <CardContent className="flex items-start gap-3 py-3 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <div>
              <span className="font-medium">سینک پذیرش‌ها هنوز کامل نشده است</span> — اعداد زیر فقط
              بازه‌ای را پوشش می‌دهند که تا الان سینک شده.
              <div className="mt-1 text-xs text-muted-foreground">
                {coverage.oldestReceptionDate ? toPersianNum(coverage.oldestReceptionDate) : "—"} تا{" "}
                {coverage.newestReceptionDate ? toPersianNum(coverage.newestReceptionDate) : "—"} ·{" "}
                {formatCount(coverage.receptionCount)} پذیرش ·{" "}
                {formatCount(coverage.lineCount)} سطر خدمت
                {coverage.syncCursorDate ? ` · سینک تا ${toPersianNum(coverage.syncCursorDate)}` : ""}
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {loading && !conversion ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="نرخ تبدیل"
              value={conv ? fmt.rate(conv.conversionRate) : "—"}
              hint={conv ? `${formatCount(conv.convertedPatients)} از ${formatCount(conv.consultedPatients)} مراجع` : undefined}
              icon={<TrendingUp className="size-4" />}
              tone="positive"
            />
            <Stat
              label="نرخ بازگشت"
              value={ret ? fmt.rate(ret.returnRate) : "—"}
              hint={ret ? `${formatCount(ret.returningPatients)} بیمار بیش از یک بار آمده‌اند` : undefined}
              icon={<Repeat className="size-4" />}
            />
            <Stat
              label="میانگین فاصله مراجعه"
              value={ret?.medianDaysBetweenVisits !== null && ret ? `${toPersianNum(ret.medianDaysBetweenVisits!)} روز` : "—"}
              hint="میانه فاصله دو مراجعه متوالی"
            />
            <Stat
              label="درآمد هر تبدیل"
              value={conv ? fmt.rial(conv.revenuePerConverted) : "—"}
              hint={conv ? `میانه ${toPersianNum(conv.medianDaysToConvert ?? 0)} روز تا اولین عمل` : undefined}
            />
            <Stat
              label="کل مراجعین"
              value={ret ? formatCount(ret.totalPatients) : "—"}
              icon={<Users className="size-4" />}
            />
            <Stat
              label="فقط یک بار آمده‌اند"
              value={ret ? formatCount(ret.singleVisitPatients) : "—"}
              hint={ret ? `${formatPercent(ret.totalPatients > 0 ? ret.singleVisitPatients / ret.totalPatients : 0)} از کل` : undefined}
              tone="warning"
            />
            <Stat
              label="میانگین مراجعه هر بیمار"
              value={ret ? toPersianNum(ret.averageVisitsPerPatient.toFixed(1)) : "—"}
            />
            <Stat
              label="نیازمند پیگیری"
              value={formatCount(followUp.length)}
              hint="بیش از ۶ ماه مراجعه نکرده‌اند"
              icon={<PhoneCall className="size-4" />}
              tone={followUp.length > 0 ? "warning" : undefined}
            />
          </div>

          <Tabs defaultValue="services">
            <TabsList>
              <TabsTrigger value="services">خدمات</TabsTrigger>
              <TabsTrigger value="conversion">نرخ تبدیل</TabsTrigger>
              <TabsTrigger value="doctors">پزشکان</TabsTrigger>
              <TabsTrigger value="retention">بازگشت</TabsTrigger>
              <TabsTrigger value="followup">پیگیری</TabsTrigger>
            </TabsList>

            <TabsContent value="services">
              <div className="mb-3 flex justify-end">
                <ExportButton dataset="services" from={from} to={to} label="خروجی همه خدمات" />
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <ArrowUpRight className="size-4 text-emerald-600" />
                      ۱۰ خدمت پرطرفدار
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">
                      ویزیت و مشاوره کنار گذاشته شده‌اند تا فهرست واقعاً درباره خدمات باشد
                    </p>
                  </CardHeader>
                  <CardContent className="p-0">
                    <ServiceTable rows={services?.top ?? []} />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <ArrowDownRight className="size-4 text-rose-600" />
                      ۱۰ خدمت کم‌طرفدار
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">
                      خدماتی که در این بازه انجام شده‌اند ولی کمترین تکرار را داشته‌اند
                    </p>
                  </CardHeader>
                  <CardContent className="p-0">
                    <ServiceTable rows={services?.bottom ?? []} />
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="conversion">
              <Card>
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <CardTitle className="text-base">تبدیل مشاوره به عمل</CardTitle>
                    <ExportButton dataset="conversion" from={from} to={to} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    بیمار وقتی «تبدیل‌شده» شمرده می‌شود که در روز مشاوره یا پس از آن، خدمت
                    غیرمشاوره‌ای دریافت کرده باشد.
                  </p>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <SortableHead label="نوع مراجعه اولیه" sortKey="name" sort={convSort.sort} onSort={convSort.toggle} defaultDirection="asc" />
                        <SortableHead label="مراجع" sortKey="consulted" sort={convSort.sort} onSort={convSort.toggle} align="left" />
                        <SortableHead label="تبدیل‌شده" sortKey="converted" sort={convSort.sort} onSort={convSort.toggle} align="left" />
                        <SortableHead label="نرخ تبدیل" sortKey="rate" sort={convSort.sort} onSort={convSort.toggle} align="left" />
                        <SortableHead label="درآمد پس از آن" sortKey="revenue" sort={convSort.sort} onSort={convSort.toggle} align="left" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {convSort.sorted.map((t) => (
                        <TableRow key={t.consultationName}>
                          <TableCell className="font-medium">{t.consultationName}</TableCell>
                          <TableCell className="text-left tabular-nums">{formatCount(t.consultedPatients)}</TableCell>
                          <TableCell className="text-left tabular-nums">{formatCount(t.convertedPatients)}</TableCell>
                          <TableCell className="text-left">
                            <MaskableRate value={t.conversionRate} hidden={fmt.masked.rates} />
                          </TableCell>
                          <TableCell className="text-left tabular-nums" title={fmt.rialExact(t.revenueAfter)}>
                            {fmt.rial(t.revenueAfter)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="doctors">
              <Card>
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Stethoscope className="size-4" />
                      رتبه‌بندی پزشکان و پرسنل
                    </CardTitle>
                    <ExportButton dataset="doctors" from={from} to={to} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    بر پایه نتیجه، نه صرفاً تعداد: درآمد، تعداد بیمار، نرخ بازگشت بیماران و نرخ تبدیل
                  </p>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10">#</TableHead>
                        <SortableHead label="نام" sortKey="name" sort={docSort.sort} onSort={docSort.toggle} defaultDirection="asc" />
                        <SortableHead label="درآمد" sortKey="revenue" sort={docSort.sort} onSort={docSort.toggle} align="left" />
                        <SortableHead label="سهم" sortKey="share" sort={docSort.sort} onSort={docSort.toggle} align="left" />
                        <SortableHead label="بیماران" sortKey="patients" sort={docSort.sort} onSort={docSort.toggle} align="left" />
                        <SortableHead label="میانگین" sortKey="avg" sort={docSort.sort} onSort={docSort.toggle} align="left" />
                        <SortableHead label="بازگشت بیمار" sortKey="repeat" sort={docSort.sort} onSort={docSort.toggle} align="left" />
                        <SortableHead label="نرخ تبدیل" sortKey="conversion" sort={docSort.sort} onSort={docSort.toggle} align="left" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {docSort.sorted.map((d, i) => (
                        <TableRow key={d.personnelName}>
                          <TableCell className="text-muted-foreground tabular-nums">{toPersianNum(i + 1)}</TableCell>
                          <TableCell className="font-medium">{d.personnelName}</TableCell>
                          <TableCell className="text-left tabular-nums" title={fmt.rialExact(d.revenue)}>
                            {fmt.rial(d.revenue)}
                          </TableCell>
                          <TableCell className="text-left tabular-nums">
                            {fmt.masked.amounts ? MASKED_FIGURE : formatPercent(d.revenueShare, 0)}
                          </TableCell>
                          <TableCell className="text-left tabular-nums">{formatCount(d.patientCount)}</TableCell>
                          <TableCell className="text-left tabular-nums">{fmt.rial(d.averageTicket)}</TableCell>
                          <TableCell className="text-left">
                            <MaskableRate value={d.repeatPatientRate} hidden={fmt.masked.rates} />
                          </TableCell>
                          <TableCell className="text-left">
                            <MaskableRate value={d.conversionRate} hidden={fmt.masked.rates} tone="amber" />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="retention">
              <Card>
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <CardTitle className="text-base">توزیع تعداد مراجعه</CardTitle>
                    <ExportButton dataset="retention" from={from} to={to} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    چند بیمار چند بار آمده‌اند و هر گروه چقدر درآمد ساخته‌اند
                  </p>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>تعداد مراجعه</TableHead>
                        <TableHead className="text-left">بیماران</TableHead>
                        <TableHead className="text-left">سهم بیماران</TableHead>
                        <TableHead className="text-left">درآمد</TableHead>
                        <TableHead className="text-left">سهم درآمد</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(() => {
                        const buckets = retention?.frequency ?? []
                        const totalPatients = buckets.reduce((s, b) => s + b.patientCount, 0)
                        const totalRevenue = buckets.reduce((s, b) => s + b.revenue, 0)
                        return buckets.map((b) => (
                          <TableRow key={b.visits}>
                            <TableCell className="font-medium tabular-nums">{b.visits}</TableCell>
                            <TableCell className="text-left tabular-nums">{formatCount(b.patientCount)}</TableCell>
                            <TableCell className="text-left">
                              <RateBar value={totalPatients > 0 ? b.patientCount / totalPatients : 0} />
                            </TableCell>
                            <TableCell className="text-left tabular-nums" title={fmt.rialExact(b.revenue)}>
                              {fmt.rial(b.revenue)}
                            </TableCell>
                            <TableCell className="text-left">
                              <MaskableRate
                                value={totalRevenue > 0 ? b.revenue / totalRevenue : 0}
                                hidden={fmt.masked.amounts}
                                tone="amber"
                              />
                            </TableCell>
                          </TableRow>
                        ))
                      })()}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="followup">
              <Card>
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <PhoneCall className="size-4" />
                      بیماران نیازمند پیگیری
                    </CardTitle>
                    <ExportButton dataset="follow-up" from={from} to={to} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    خدمت پولی گرفته‌اند، بیش از ۶ ماه نیامده‌اند، و بر اساس ارزششان مرتب شده‌اند
                  </p>
                </CardHeader>
                <CardContent className="p-0">
                  {followUp.length === 0 ? (
                    <div className="py-10 text-center text-sm text-muted-foreground">
                      بیماری در این بازه برای پیگیری یافت نشد.
                      {coverage && !coverage.syncComplete
                        ? " تا کامل شدن سینک پذیرش‌ها این فهرست ناقص است."
                        : ""}
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <SortableHead label="بیمار" sortKey="name" sort={fuSort.sort} onSort={fuSort.toggle} defaultDirection="asc" />
                          <TableHead>آخرین خدمات</TableHead>
                          <SortableHead label="آخرین مراجعه" sortKey="days" sort={fuSort.sort} onSort={fuSort.toggle} align="left" />
                          <SortableHead label="مراجعه" sortKey="visits" sort={fuSort.sort} onSort={fuSort.toggle} align="left" />
                          <SortableHead label="ارزش" sortKey="value" sort={fuSort.sort} onSort={fuSort.toggle} align="left" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {fuSort.sorted.map((c) => (
                          <TableRow
                            key={c.patientExternalCode}
                            className="cursor-pointer"
                            onClick={() => setSelected(c.patientExternalCode)}
                            title="مشاهده پرونده بیمار"
                          >
                            <TableCell>
                              <div className="font-medium">{c.fullName ?? "—"}</div>
                              <div className="text-xs text-muted-foreground tabular-nums">
                                {c.mobile ? toPersianNum(c.mobile) : "—"}
                              </div>
                            </TableCell>
                            <TableCell className="max-w-[20rem] text-xs">{c.lastServices ?? "—"}</TableCell>
                            <TableCell className="text-left">
                              <div className="tabular-nums">{c.lastVisitDate ? toPersianNum(c.lastVisitDate) : "—"}</div>
                              <Badge variant="secondary" className="mt-1">
                                {toPersianNum(Math.round(c.daysSinceLastVisit / 30))} ماه پیش
                              </Badge>
                            </TableCell>
                            <TableCell className="text-left tabular-nums">{toPersianNum(c.visitCount)}</TableCell>
                            <TableCell className="text-left tabular-nums" title={fmt.rialExact(c.totalReceived)}>
                              {fmt.rial(c.totalReceived)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </>
      )}

      <PatientDetailDialog
        externalCode={selected}
        open={selected !== null}
        onOpenChange={(o) => { if (!o) setSelected(null) }}
      />
    </div>
  )
}

/**
 * Per-tab CSV export.
 *
 * One button per tab rather than one for the page: each tab is its own table
 * with its own columns, and a single «خروجی» that guessed which one you meant
 * would be wrong four times out of five. The file covers the whole table for
 * the current date range, not the rows on screen.
 */
function ExportButton({
  dataset,
  from,
  to,
  label = "خروجی اکسل",
}: {
  dataset: "services" | "conversion" | "doctors" | "retention" | "follow-up"
  from: string
  to: string
  label?: string
}) {
  const [busy, setBusy] = useState(false)

  const run = async () => {
    setBusy(true)
    try {
      const qs = new URLSearchParams({ dataset })
      if (from) qs.set("from", from)
      if (to) qs.set("to", to)
      await apiDownload(`/api/visitors/export?${qs.toString()}`, `${dataset}.csv`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "خطا در دریافت خروجی")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={() => void run()} disabled={busy}>
      <Download className={`size-4 ${busy ? "animate-pulse" : ""}`} />
      {label}
    </Button>
  )
}

function ServiceTable({ rows }: { rows: ServicePopularity[] }) {
  const fmt = useCrmFormat()
  if (rows.length === 0) {
    return <div className="py-8 text-center text-sm text-muted-foreground">داده‌ای موجود نیست.</div>
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-10">#</TableHead>
          <TableHead>خدمت</TableHead>
          <TableHead className="text-left">دفعات</TableHead>
          <TableHead className="text-left">بیماران</TableHead>
          <TableHead className="text-left">درآمد</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((s, i) => (
          <TableRow key={`${s.serviceExternalId ?? "x"}-${s.serviceName}`}>
            <TableCell className="text-muted-foreground tabular-nums">{toPersianNum(i + 1)}</TableCell>
            <TableCell>
              <div className="font-medium">{s.serviceName}</div>
              {s.sectionName ? (
                <div className="text-xs text-muted-foreground">{s.sectionName}</div>
              ) : null}
            </TableCell>
            <TableCell className="text-left tabular-nums">{formatCount(s.receptionCount)}</TableCell>
            <TableCell className="text-left tabular-nums">{formatCount(s.patientCount)}</TableCell>
            <TableCell className="text-left tabular-nums" title={fmt.rialExact(s.revenue)}>
              {fmt.rial(s.revenue)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
