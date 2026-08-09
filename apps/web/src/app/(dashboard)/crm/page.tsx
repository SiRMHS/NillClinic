"use client"

import { useEffect, useMemo, useState, useSyncExternalStore } from "react"
import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  Tooltip,
  type ChartOptions,
} from "chart.js"
import { Bar, Doughnut } from "react-chartjs-2"
import {
  BadgeCheck,
  BriefcaseBusiness,
  ContactRound,
  MapPin,
  Megaphone,
  UsersRound,
} from "lucide-react"
import { apiFetch } from "@/lib/api-client"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Skeleton } from "@/components/ui/skeleton"

ChartJS.register(ArcElement, BarElement, CategoryScale, LinearScale, Tooltip, Legend)

interface DistributionItem {
  name: string
  count: number
  percent: number
}

interface PatientCrmAnalysis {
  totalPatients: number
  generatedAt: string
  genderDistribution: DistributionItem[]
  residenceDistribution: DistributionItem[]
  residentStatusDistribution: DistributionItem[]
  introductionDistribution: DistributionItem[]
  occupationDistribution: DistributionItem[]
}

const persianNumber = new Intl.NumberFormat("fa-IR")
const chartColors = ["#7c3aed", "#06b6d4", "#f59e0b", "#10b981", "#f43f5e", "#6366f1", "#14b8a6", "#ec4899"]

function ChartWrapper({ children, label }: { children: React.ReactNode; label: string }) {
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  )

  if (!mounted) return <Skeleton className="h-full w-full rounded-xl" />
  return <div className="relative h-full w-full min-w-0" role="img" aria-label={label}>{children}</div>
}

function recordedCount(items: DistributionItem[]): number {
  return items
    .filter((item) => item.name !== "ثبت نشده")
    .reduce((sum, item) => sum + item.count, 0)
}

function percentOf(value: number, total: number): string {
  if (total === 0) return "۰٪"
  return `${new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 1 }).format((value / total) * 100)}٪`
}

function compactDistribution(
  items: DistributionItem[],
  maxItems: number,
  remainderLabel: string,
): DistributionItem[] {
  if (items.length <= maxItems) return items

  const visibleItems = items.slice(0, maxItems - 1)
  const remainder = items.slice(maxItems - 1).reduce(
    (totals, item) => ({
      count: totals.count + item.count,
      percent: totals.percent + item.percent,
    }),
    { count: 0, percent: 0 },
  )

  return [...visibleItems, { name: remainderLabel, ...remainder }]
}

export default function CrmPage() {
  const [activeTab, setActiveTab] = useState("patients")
  const [data, setData] = useState<PatientCrmAnalysis | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    apiFetch<PatientCrmAnalysis>("/api/analytics/crm/patients")
      .then((result) => {
        if (active) setData(result)
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "دریافت تحلیل CRM ناموفق بود")
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [])

  const doughnutOptions = useMemo<ChartOptions<"doughnut">>(() => ({
    responsive: true,
    maintainAspectRatio: false,
    cutout: "62%",
    plugins: {
      legend: {
        position: "bottom",
        rtl: true,
        labels: { usePointStyle: true, pointStyle: "circle", padding: 18, font: { family: "inherit", size: 12 } },
      },
      tooltip: { rtl: true, titleFont: { family: "inherit" }, bodyFont: { family: "inherit" } },
    },
  }), [])

  const horizontalBarOptions = useMemo<ChartOptions<"bar">>(() => ({
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: "y",
    plugins: {
      legend: { display: false },
      tooltip: { rtl: true, titleFont: { family: "inherit" }, bodyFont: { family: "inherit" } },
    },
    scales: {
      x: { beginAtZero: true, grid: { color: "rgba(148, 163, 184, 0.15)" }, ticks: { font: { family: "inherit" } } },
      y: { grid: { display: false }, ticks: { font: { family: "inherit", size: 11 } } },
    },
  }), [])

  const occupationBarOptions = useMemo<ChartOptions<"bar">>(() => ({
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: "y",
    layout: { padding: { top: 8, right: 12, bottom: 8, left: 20 } },
    datasets: { bar: { barThickness: 28, borderRadius: 8 } },
    plugins: {
      legend: { display: false },
      tooltip: {
        rtl: true,
        titleFont: { family: "inherit", size: 14 },
        bodyFont: { family: "inherit", size: 14 },
        padding: 12,
      },
    },
    scales: {
      x: {
        beginAtZero: true,
        grace: "6%",
        grid: { color: "rgba(148, 163, 184, 0.18)" },
        ticks: {
          maxTicksLimit: 8,
          padding: 8,
          font: { family: "inherit", size: 13 },
          callback: (value) => persianNumber.format(Number(value)),
        },
      },
      y: {
        grid: { display: false },
        ticks: {
          autoSkip: false,
          padding: 10,
          font: { family: "inherit", size: 14, weight: 500 },
        },
      },
    },
  }), [])

  if (loading) {
    return (
      <div className="space-y-6" dir="rtl">
        <Skeleton className="h-24 w-full" />
        <div className="grid gap-4 md:grid-cols-4">{[1, 2, 3, 4].map((item) => <Skeleton key={item} className="h-28" />)}</div>
        <div className="grid gap-4 lg:grid-cols-2"><Skeleton className="h-96" /><Skeleton className="h-96" /></div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <Card dir="rtl">
        <CardContent className="flex min-h-52 items-center justify-center text-destructive">
          {error || "اطلاعات تحلیل در دسترس نیست"}
        </CardContent>
      </Card>
    )
  }

  const genderRecorded = recordedCount(data.genderDistribution)
  const introductionRecorded = recordedCount(data.introductionDistribution)
  const occupationRecorded = recordedCount(data.occupationDistribution)
  const occupationChartItems = compactDistribution(data.occupationDistribution, 25, "سایر مشاغل")

  const genderChart = {
    labels: data.genderDistribution.map((item) => item.name),
    datasets: [{ data: data.genderDistribution.map((item) => item.count), backgroundColor: chartColors, borderWidth: 0 }],
  }
  const residentChart = {
    labels: data.residentStatusDistribution.map((item) => item.name),
    datasets: [{ data: data.residentStatusDistribution.map((item) => item.count), backgroundColor: ["#10b981", "#06b6d4", "#94a3b8"], borderWidth: 0 }],
  }
  const introductionChart = {
    labels: data.introductionDistribution.map((item) => item.name),
    datasets: [{ data: data.introductionDistribution.map((item) => item.count), backgroundColor: "rgba(124, 58, 237, 0.82)", borderRadius: 7 }],
  }
  const residenceChart = {
    labels: data.residenceDistribution.map((item) => item.name),
    datasets: [{ data: data.residenceDistribution.map((item) => item.count), backgroundColor: "rgba(6, 182, 212, 0.82)", borderRadius: 7 }],
  }
  const occupationChart = {
    labels: occupationChartItems.map((item) => item.name),
    datasets: [{ data: occupationChartItems.map((item) => item.count), backgroundColor: "rgba(245, 158, 11, 0.82)", borderRadius: 7 }],
  }

  const stats = [
    { label: "کل مراجعین", value: persianNumber.format(data.totalPatients), hint: "پرونده ثبت‌شده", icon: UsersRound, tone: "text-violet-600 bg-violet-500/10" },
    { label: "اطلاعات جنسیت", value: percentOf(genderRecorded, data.totalPatients), hint: `${persianNumber.format(genderRecorded)} پرونده کامل`, icon: BadgeCheck, tone: "text-cyan-600 bg-cyan-500/10" },
    { label: "نحوه آشنایی", value: percentOf(introductionRecorded, data.totalPatients), hint: `${persianNumber.format(introductionRecorded)} پاسخ ثبت‌شده`, icon: Megaphone, tone: "text-emerald-600 bg-emerald-500/10" },
    { label: "اطلاعات شغلی", value: percentOf(occupationRecorded, data.totalPatients), hint: `${persianNumber.format(occupationRecorded)} عنوان ثبت‌شده`, icon: BriefcaseBusiness, tone: "text-amber-600 bg-amber-500/10" },
  ]

  return (
    <div className="space-y-6" dir="rtl">
      <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-l from-violet-600/10 via-background to-cyan-500/10 p-6">
        <div className="relative z-10 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
              <ContactRound className="size-7 text-violet-600" />
              CRM
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">داشبورد تحلیل و مدیریت مراجعین</p>
          </div>
          <div className="rounded-xl border bg-background/80 px-4 py-3 text-xs text-muted-foreground backdrop-blur">
            آخرین محاسبه: {new Date(data.generatedAt).toLocaleString("fa-IR")}
          </div>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} dir="rtl">
        <TabsList className="w-full justify-start rounded-xl p-1 group-data-horizontal/tabs:h-12 sm:w-fit">
          <TabsTrigger value="patients" className="h-10 min-h-10 flex-none rounded-lg px-5">
            <UsersRound className="size-4" />
            تحلیل مراجعین
          </TabsTrigger>
        </TabsList>

        <TabsContent value="patients" className="space-y-5 pt-2">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {stats.map(({ label, value, hint, icon: Icon, tone }) => (
              <Card key={label} className="overflow-hidden">
                <CardContent className="flex items-center justify-between gap-4 p-5">
                  <div>
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="mt-1 text-2xl font-bold">{value}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>
                  </div>
                  <div className={`rounded-2xl p-3 ${tone}`}><Icon className="size-6" /></div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><UsersRound className="size-4 text-violet-600" />ترکیب جنسیتی مراجعین</CardTitle></CardHeader>
              <CardContent className="h-80"><ChartWrapper label="نمودار ترکیب جنسیتی"><Doughnut data={genderChart} options={doughnutOptions} /></ChartWrapper></CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><BadgeCheck className="size-4 text-emerald-600" />وضعیت اقامت</CardTitle></CardHeader>
              <CardContent className="h-80"><ChartWrapper label="نمودار وضعیت اقامت"><Doughnut data={residentChart} options={doughnutOptions} /></ChartWrapper></CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Megaphone className="size-4 text-violet-600" />مراجعین چگونه با ما آشنا شده‌اند؟</CardTitle></CardHeader>
            <CardContent className="h-[360px]"><ChartWrapper label="نمودار نحوه آشنایی"><Bar data={introductionChart} options={horizontalBarOptions} /></ChartWrapper></CardContent>
          </Card>

          <div className="space-y-5">
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><MapPin className="size-4 text-cyan-600" />محل اقامت مراجعین</CardTitle></CardHeader>
              <CardContent className="max-h-[680px] overflow-y-auto">
                <div style={{ height: `${Math.max(360, data.residenceDistribution.length * 34)}px` }}>
                  <ChartWrapper label="نمودار محل اقامت"><Bar data={residenceChart} options={horizontalBarOptions} /></ChartWrapper>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base"><BriefcaseBusiness className="size-4 text-amber-600" />مشاغل مراجعین</CardTitle>
                {data.occupationDistribution.length > occupationChartItems.length && (
                  <p className="text-xs text-muted-foreground">
                    نمایش ۲۴ شغل پرتکرار؛ {persianNumber.format(data.occupationDistribution.length - 24)} عنوان دیگر در «سایر مشاغل» تجمیع شده‌اند.
                  </p>
                )}
              </CardHeader>
              <CardContent className="max-h-[960px] overflow-auto pb-6">
                <div
                  className="relative min-w-[900px] w-full"
                  style={{ height: `${Math.max(620, occupationChartItems.length * 52)}px` }}
                >
                  <ChartWrapper label="نمودار مشاغل"><Bar data={occupationChart} options={occupationBarOptions} /></ChartWrapper>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
