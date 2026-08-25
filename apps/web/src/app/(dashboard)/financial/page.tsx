"use client"

import { useCallback, useEffect, useState, useSyncExternalStore } from "react"
import { apiFetch } from "@/lib/api-client"
import {
  formatCount,
  formatJalaliPeriod,
  formatPercent,
  formatRial,
  formatRialExact,
  toPersianNum,
} from "@/lib/format"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Skeleton } from "@/components/ui/skeleton"
import { DateRangeFilter } from "@/components/ui/date-range-filter"
import { SortableHead, useSortableRows } from "@/components/ui/sortable-table"
import {
  Banknote, TrendingDown, Wallet, Receipt, Users, PieChart as PieIcon,
  Layers, UserCog, RefreshCw,
} from "lucide-react"
import {
  Chart as ChartJS, ArcElement, Tooltip, Legend, CategoryScale, LinearScale,
  BarElement, PointElement, LineElement, Filler,
} from "chart.js"
import type { ChartType, ChartOptions, TooltipItem } from "chart.js"
import { Doughnut, Bar, Line } from "react-chartjs-2"

ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement, PointElement, LineElement, Filler)

interface RevenueSummary {
  totalReceived: number
  totalDiscount: number
  totalOutstanding: number
  totalDeposit: number
  grossBilled: number
  discountRate: number
  receptionCount: number
  lineCount: number
  uniquePatients: number
  averageTicket: number
}
interface RevenuePoint {
  period: string
  received: number
  discount: number
  outstanding: number
  receptionCount: number
}
interface RevenueByService {
  serviceExternalId: number | null
  serviceName: string
  sectionName: string | null
  received: number
  discount: number
  lineCount: number
  uniquePatients: number
  averagePrice: number
}
interface RevenueBySection {
  sectionId: number | null
  sectionName: string
  received: number
  discount: number
  lineCount: number
  share: number
}
interface RevenueByPersonnel {
  personnelName: string
  received: number
  discount: number
  lineCount: number
  uniquePatients: number
  averagePerPatient: number
}

const COLORS = [
  "#2563eb", "#16a34a", "#d97706", "#dc2626", "#8b5cf6",
  "#ec4899", "#06b6d4", "#f97316", "#6366f1", "#14b8a6",
]

const font = { family: "system-ui, sans-serif" }

/**
 * Rial amounts are scaled on axes and in cells, so the tooltip is the only
 * place the exact figure is shown. Generic per chart type because chart.js
 * types `parsed` differently for cartesian charts (an {x,y} object) and
 * doughnuts (a bare number).
 */
function moneyTooltip<TType extends ChartType>() {
  return {
    bodyFont: font,
    titleFont: font,
    callbacks: {
      label: (ctx: TooltipItem<TType>) => {
        // Read `raw` (the original data value) rather than `parsed`. On a
        // horizontal bar chart (indexAxis: "y") the measure lives in parsed.x
        // and parsed.y holds the category index, so reading parsed.y showed the
        // row number formatted as rials.
        const raw = ctx.raw
        const parsed = ctx.parsed as number | { x?: number; y?: number }
        const value =
          typeof raw === "number"
            ? raw
            : typeof parsed === "number"
              ? parsed
              : (parsed?.x ?? parsed?.y ?? 0)
        const name = (ctx.dataset as { label?: string } | undefined)?.label ?? ctx.label ?? ""
        return `${name}: ${formatRialExact(Number(value))}`
      },
    },
  }
}

/** Charts read from the DOM, so defer them until after hydration. */
function ChartWrapper({ children }: { children: React.ReactNode }) {
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  )
  if (!mounted) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Skeleton className="h-full w-full" />
      </div>
    )
  }
  return <>{children}</>
}

function KpiCard({
  title, value, hint, icon, tone = "default",
}: {
  title: string
  value: string
  hint?: string
  icon: React.ReactNode
  tone?: "default" | "positive" | "warning" | "danger"
}) {
  const toneClass =
    tone === "positive" ? "text-emerald-600 dark:text-emerald-400"
    : tone === "warning" ? "text-amber-600 dark:text-amber-400"
    : tone === "danger" ? "text-rose-600 dark:text-rose-400"
    : "text-foreground"

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <span className="text-muted-foreground">{icon}</span>
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold tabular-nums ${toneClass}`}>{value}</div>
        {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  )
}

type Granularity = "day" | "month" | "year"

export default function FinancialPage() {
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [granularity, setGranularity] = useState<Granularity>("month")

  const [summary, setSummary] = useState<RevenueSummary | null>(null)
  const [trend, setTrend] = useState<RevenuePoint[]>([])
  const [services, setServices] = useState<RevenueByService[]>([])
  const [sections, setSections] = useState<RevenueBySection[]>([])
  const [personnel, setPersonnel] = useState<RevenueByPersonnel[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const resolved = getComputedStyle(document.documentElement).fontFamily
    if (resolved) ChartJS.defaults.font.family = resolved
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const qs = new URLSearchParams()
    if (from) qs.set("from", from)
    if (to) qs.set("to", to)
    const range = qs.toString() ? `?${qs.toString()}` : ""

    try {
      const [s, t, svc, sec, per] = await Promise.all([
        apiFetch<RevenueSummary>(`/api/financial/summary${range}`),
        apiFetch<RevenuePoint[]>(
          `/api/financial/trend${range ? `${range}&` : "?"}granularity=${granularity}`,
        ),
        apiFetch<RevenueByService[]>(`/api/financial/by-service${range ? `${range}&` : "?"}limit=15`),
        apiFetch<RevenueBySection[]>(`/api/financial/by-section${range}`),
        apiFetch<RevenueByPersonnel[]>(`/api/financial/by-personnel${range ? `${range}&` : "?"}limit=20`),
      ])
      setSummary(s)
      setTrend(t)
      setServices(svc)
      setSections(sec)
      setPersonnel(per)
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطا در دریافت اطلاعات مالی")
    } finally {
      setLoading(false)
    }
  }, [from, to, granularity])

  useEffect(() => {
    void load()
  }, [load])

  // These tables hold their full result set, so sorting client-side is honest
  // (unlike the paginated ranking table, which sorts server-side).
  const svcSort = useSortableRows(
    services,
    {
      name: (r) => r.serviceName,
      section: (r) => r.sectionName,
      received: (r) => r.received,
      discount: (r) => r.discount,
      lines: (r) => r.lineCount,
      patients: (r) => r.uniquePatients,
      avg: (r) => r.averagePrice,
    },
    { key: "received", direction: "desc" },
  )
  const secSort = useSortableRows(
    sections,
    {
      name: (r) => r.sectionName,
      received: (r) => r.received,
      discount: (r) => r.discount,
      lines: (r) => r.lineCount,
      share: (r) => r.share,
    },
    { key: "received", direction: "desc" },
  )
  const perSort = useSortableRows(
    personnel,
    {
      name: (r) => r.personnelName,
      received: (r) => r.received,
      discount: (r) => r.discount,
      lines: (r) => r.lineCount,
      patients: (r) => r.uniquePatients,
      avg: (r) => r.averagePerPatient,
    },
    { key: "received", direction: "desc" },
  )

  const hasData = summary !== null && summary.lineCount > 0

  const trendData = {
    labels: trend.map((p) => formatJalaliPeriod(p.period)),
    datasets: [
      {
        label: "دریافتی",
        data: trend.map((p) => p.received),
        borderColor: COLORS[0],
        backgroundColor: `${COLORS[0]}22`,
        fill: true,
        tension: 0.3,
      },
      {
        label: "تخفیف",
        data: trend.map((p) => p.discount),
        borderColor: COLORS[3],
        backgroundColor: `${COLORS[3]}22`,
        fill: true,
        tension: 0.3,
      },
    ],
  }


  const trendOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index" as const, intersect: false },
    plugins: {
      legend: { labels: { ...font, boxWidth: 12, padding: 12 } },
      tooltip: moneyTooltip<"line">(),
    },
    scales: {
      y: {
        ticks: {
          font,
          callback: (value: string | number) => formatRial(Number(value)),
        },
      },
      x: { ticks: { font } },
    },
  } satisfies ChartOptions<"line">

  const sectionData = {
    labels: sections.slice(0, 10).map((s) => s.sectionName),
    datasets: [
      {
        data: sections.slice(0, 10).map((s) => s.received),
        backgroundColor: COLORS,
        borderWidth: 0,
      },
    ],
  }

  const serviceBarData = {
    labels: services.slice(0, 10).map((s) => s.serviceName),
    datasets: [
      {
        label: "دریافتی",
        data: services.slice(0, 10).map((s) => s.received),
        backgroundColor: COLORS[0],
        borderRadius: 4,
      },
    ],
  }

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6" dir="rtl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">تحلیل مالی</h1>
          <p className="text-sm text-muted-foreground">
            بر پایه سطرهای مالی پذیرش — دریافتی، تخفیف و مانده
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
          <CardContent className="py-6 text-center text-sm text-rose-600 dark:text-rose-400">
            {error}
          </CardContent>
        </Card>
      ) : null}

      {loading && !summary ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      ) : !hasData ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            داده مالی‌ای برای این بازه وجود ندارد.
            <br />
            اگر سینک پذیرش‌ها هنوز کامل نشده، پس از پایان آن دوباره بررسی کنید.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              title="مجموع دریافتی"
              value={formatRial(summary.totalReceived)}
              hint={formatRialExact(summary.totalReceived)}
              icon={<Banknote className="size-4" />}
              tone="positive"
            />
            <KpiCard
              title="مجموع تخفیف"
              value={formatRial(summary.totalDiscount)}
              hint={`${formatPercent(summary.discountRate)} از کل صورتحساب`}
              icon={<TrendingDown className="size-4" />}
              tone="warning"
            />
            <KpiCard
              title="مانده دریافت‌نشده"
              value={formatRial(summary.totalOutstanding)}
              hint="بدهی باقیمانده بیماران"
              icon={<Wallet className="size-4" />}
              tone={summary.totalOutstanding > 0 ? "danger" : "default"}
            />
            <KpiCard
              title="میانگین هر پذیرش"
              value={formatRial(summary.averageTicket)}
              hint={`${formatCount(summary.receptionCount)} پذیرش`}
              icon={<Receipt className="size-4" />}
            />
            <KpiCard
              title="صورتحساب ناخالص"
              value={formatRial(summary.grossBilled)}
              hint="دریافتی + تخفیف"
              icon={<Banknote className="size-4" />}
            />
            <KpiCard
              title="بیماران یکتا"
              value={formatCount(summary.uniquePatients)}
              hint={`${formatCount(summary.lineCount)} سطر خدمت`}
              icon={<Users className="size-4" />}
            />
            <KpiCard
              title="پیش‌پرداخت"
              value={formatRial(summary.totalDeposit)}
              hint="مبالغ امانی"
              icon={<Wallet className="size-4" />}
            />
            <KpiCard
              title="درآمد به ازای بیمار"
              value={formatRial(
                summary.uniquePatients > 0 ? summary.totalReceived / summary.uniquePatients : 0,
              )}
              hint="میانگین ارزش هر بیمار"
              icon={<Users className="size-4" />}
            />
          </div>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Layers className="size-4" />
                روند درآمد
              </CardTitle>
              <Tabs value={granularity} onValueChange={(v) => setGranularity(v as Granularity)}>
                <TabsList>
                  <TabsTrigger value="day">روزانه</TabsTrigger>
                  <TabsTrigger value="month">ماهانه</TabsTrigger>
                  <TabsTrigger value="year">سالانه</TabsTrigger>
                </TabsList>
              </Tabs>
            </CardHeader>
            <CardContent>
              <div className="h-[320px]">
                <ChartWrapper>
                  <Line data={trendData} options={trendOptions} />
                </ChartWrapper>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <PieIcon className="size-4" />
                  سهم بخش‌ها از درآمد
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ChartWrapper>
                    <Doughnut
                      data={sectionData}
                      options={{
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                          legend: { position: "left", labels: { ...font, boxWidth: 12, padding: 8 } },
                          tooltip: moneyTooltip<"doughnut">(),
                        },
                      }}
                    />
                  </ChartWrapper>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">پردرآمدترین خدمات</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ChartWrapper>
                    <Bar
                      data={serviceBarData}
                      options={{
                        responsive: true,
                        maintainAspectRatio: false,
                        indexAxis: "y" as const,
                        plugins: { legend: { display: false }, tooltip: moneyTooltip<"bar">() },
                        scales: {
                          x: {
                            ticks: {
                              font,
                              callback: (v: string | number) => formatRial(Number(v)),
                            },
                          },
                          y: { ticks: { font, autoSkip: false } },
                        },
                      }}
                    />
                  </ChartWrapper>
                </div>
              </CardContent>
            </Card>
          </div>

          <Tabs defaultValue="services">
            <TabsList>
              <TabsTrigger value="services">خدمات</TabsTrigger>
              <TabsTrigger value="sections">بخش‌ها</TabsTrigger>
              <TabsTrigger value="personnel">پرسنل</TabsTrigger>
            </TabsList>

            <TabsContent value="services">
              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <SortableHead label="خدمت" sortKey="name" sort={svcSort.sort} onSort={svcSort.toggle} defaultDirection="asc" />
                        <SortableHead label="بخش" sortKey="section" sort={svcSort.sort} onSort={svcSort.toggle} defaultDirection="asc" />
                        <SortableHead label="دریافتی" sortKey="received" sort={svcSort.sort} onSort={svcSort.toggle} align="left" />
                        <SortableHead label="تخفیف" sortKey="discount" sort={svcSort.sort} onSort={svcSort.toggle} align="left" />
                        <SortableHead label="تعداد" sortKey="lines" sort={svcSort.sort} onSort={svcSort.toggle} align="left" />
                        <SortableHead label="بیماران" sortKey="patients" sort={svcSort.sort} onSort={svcSort.toggle} align="left" />
                        <SortableHead label="میانگین" sortKey="avg" sort={svcSort.sort} onSort={svcSort.toggle} align="left" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {svcSort.sorted.map((s) => (
                        <TableRow key={`${s.serviceExternalId ?? "x"}-${s.serviceName}`}>
                          <TableCell className="font-medium">{s.serviceName}</TableCell>
                          <TableCell className="text-muted-foreground">{s.sectionName ?? "—"}</TableCell>
                          <TableCell className="text-left tabular-nums" title={formatRialExact(s.received)}>
                            {formatRial(s.received)}
                          </TableCell>
                          <TableCell className="text-left tabular-nums text-amber-600 dark:text-amber-400">
                            {formatRial(s.discount)}
                          </TableCell>
                          <TableCell className="text-left tabular-nums">{formatCount(s.lineCount)}</TableCell>
                          <TableCell className="text-left tabular-nums">{formatCount(s.uniquePatients)}</TableCell>
                          <TableCell className="text-left tabular-nums">{formatRial(s.averagePrice)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="sections">
              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <SortableHead label="بخش" sortKey="name" sort={secSort.sort} onSort={secSort.toggle} defaultDirection="asc" />
                        <SortableHead label="دریافتی" sortKey="received" sort={secSort.sort} onSort={secSort.toggle} align="left" />
                        <SortableHead label="تخفیف" sortKey="discount" sort={secSort.sort} onSort={secSort.toggle} align="left" />
                        <SortableHead label="تعداد سطر" sortKey="lines" sort={secSort.sort} onSort={secSort.toggle} align="left" />
                        <SortableHead label="سهم" sortKey="share" sort={secSort.sort} onSort={secSort.toggle} align="left" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {secSort.sorted.map((s) => (
                        <TableRow key={`${s.sectionId ?? "x"}-${s.sectionName}`}>
                          <TableCell className="font-medium">{s.sectionName}</TableCell>
                          <TableCell className="text-left tabular-nums" title={formatRialExact(s.received)}>
                            {formatRial(s.received)}
                          </TableCell>
                          <TableCell className="text-left tabular-nums text-amber-600 dark:text-amber-400">
                            {formatRial(s.discount)}
                          </TableCell>
                          <TableCell className="text-left tabular-nums">{formatCount(s.lineCount)}</TableCell>
                          <TableCell className="text-left tabular-nums">{formatPercent(s.share)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="personnel">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <UserCog className="size-4" />
                    درآمد به تفکیک پرسنل
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <SortableHead label="پرسنل" sortKey="name" sort={perSort.sort} onSort={perSort.toggle} defaultDirection="asc" />
                        <SortableHead label="دریافتی" sortKey="received" sort={perSort.sort} onSort={perSort.toggle} align="left" />
                        <SortableHead label="تخفیف" sortKey="discount" sort={perSort.sort} onSort={perSort.toggle} align="left" />
                        <SortableHead label="تعداد خدمت" sortKey="lines" sort={perSort.sort} onSort={perSort.toggle} align="left" />
                        <SortableHead label="بیماران" sortKey="patients" sort={perSort.sort} onSort={perSort.toggle} align="left" />
                        <SortableHead label="میانگین هر بیمار" sortKey="avg" sort={perSort.sort} onSort={perSort.toggle} align="left" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {perSort.sorted.map((p) => (
                        <TableRow key={p.personnelName}>
                          <TableCell className="font-medium">{p.personnelName}</TableCell>
                          <TableCell className="text-left tabular-nums" title={formatRialExact(p.received)}>
                            {formatRial(p.received)}
                          </TableCell>
                          <TableCell className="text-left tabular-nums text-amber-600 dark:text-amber-400">
                            {formatRial(p.discount)}
                          </TableCell>
                          <TableCell className="text-left tabular-nums">{formatCount(p.lineCount)}</TableCell>
                          <TableCell className="text-left tabular-nums">{formatCount(p.uniquePatients)}</TableCell>
                          <TableCell className="text-left tabular-nums">
                            {formatRial(p.averagePerPatient)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>

          <p className="text-xs text-muted-foreground">
            مبالغ به ریال. برای دیدن عدد دقیق، نشانگر را روی مقدار نگه دارید.
            تاریخ‌ها شمسی‌اند و بازه انتخابی هر دو سر را در بر می‌گیرد.
            {summary.lineCount > 0
              ? ` مبنای محاسبه: ${toPersianNum(summary.lineCount.toLocaleString("en-US"))} سطر خدمت.`
              : ""}
          </p>
        </>
      )}
    </div>
  )
}
