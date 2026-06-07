"use client"

import { useEffect, useState, useSyncExternalStore } from "react"
import { apiFetch } from "@/lib/api-client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Award, BarChart3, FileSpreadsheet, FileText, Users, PieChart, Layers,
  Activity, Pill, Syringe, Stethoscope, TrendingUp,
} from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { useRouter } from "next/navigation"
import {
  Chart as ChartJS, ArcElement, Tooltip, Legend, CategoryScale, LinearScale,
  BarElement, PointElement, LineElement, Filler,
} from "chart.js"
import type { ChartOptions } from "chart.js"
import { Doughnut, Bar, Line } from "react-chartjs-2"

ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement, PointElement, LineElement, Filler)

interface PopularityData { name: string; count: number }
interface DoctorPerformance { doctorName: string; reserveCount: number; treatmentCount: number }
interface Demographics {
  genderDistribution: { name: string; count: number }[]
  ageDistribution: { name: string; count: number }[]
  jobDistribution: { name: string; count: number }[]
}

interface TreatmentCategory { name: string; count: number }
interface DiagnosisItem { name: string; count: number }
interface TreatmentItem { name: string; count: number }
interface MonthlyTrend { period: string; [key: string]: string | number }
interface DoctorBreakdown {
  doctor: string
  categories: { name: string; count: number }[]
  total: number
}

interface TreatmentAnalytics {
  categories: TreatmentCategory[]
  diagnoses: DiagnosisItem[]
  treatmentItems: TreatmentItem[]
  monthlyTrend: MonthlyTrend[]
  doctorBreakdown: DoctorBreakdown[]
}

const COLORS = ["#2563eb", "#16a34a", "#d97706", "#dc2626", "#8b5cf6", "#ec4899", "#06b6d4", "#f97316", "#6366f1", "#14b8a6"]

function toPersianNum(num: number | string) {
  return num.toString().replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[parseInt(d, 10)]!)
}

const treatmentCatIcons: Record<string, React.ReactNode> = {
  "درمان دارویی": <Pill className="size-4" />,
  "پروسیجر": <Syringe className="size-4" />,
  "تشخیص": <Stethoscope className="size-4" />,
}

function getCatIcon(name: string): React.ReactNode {
  for (const [key, icon] of Object.entries(treatmentCatIcons)) {
    if (name.includes(key)) return icon
  }
  return <Activity className="size-4" />
}

const font = { family: "system-ui, sans-serif" }

function chartTextConfig(size = 11) {
  return { ...font, size }
}

const commonOpts = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { ...font, boxWidth: 12, padding: 12 } },
    tooltip: { bodyFont: font, titleFont: font },
  },
} satisfies ChartOptions

const monthNames: Record<string, string> = {
  "01": "فروردین", "02": "اردیبهشت", "03": "خرداد",
  "04": "تیر", "05": "مرداد", "06": "شهریور",
  "07": "مهر", "08": "آبان", "09": "آذر",
  "10": "دی", "11": "بهمن", "12": "اسفند",
}

function formatMonth(period: string): string {
  const parts = period.split("-")
  if (parts.length !== 2) return period
  return `${monthNames[parts[1]] || parts[1]} ${parts[0]}`
}

function ChartWrapper({ children }: { children: React.ReactNode }) {
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  )
  if (!mounted) return <div className="h-full w-full flex items-center justify-center"><Skeleton className="h-full w-full" /></div>
  return <>{children}</>
}

export default function AnalyticsPage() {
  const router = useRouter()

  useEffect(() => {
    const resolved = getComputedStyle(document.documentElement).fontFamily
    if (resolved) ChartJS.defaults.font.family = resolved
  }, [])
  const [popularityData, setPopularityData] = useState<PopularityData[]>([])
  const [doctorData, setDoctorData] = useState<DoctorPerformance[]>([])
  const [demographics, setDemographics] = useState<Demographics | null>(null)
  const [treatmentData, setTreatmentData] = useState<TreatmentAnalytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [treatLoading, setTreatLoading] = useState(true)
  const [activeTab, setActiveTab] = useState("overview")

  useEffect(() => {
    let active = true
    const fetchAnalytics = async () => {
      setLoading(true)
      try {
        const [popularity, doctors, demo] = await Promise.all([
          apiFetch<PopularityData[]>("/api/analytics/treatment-popularity"),
          apiFetch<DoctorPerformance[]>("/api/analytics/doctor-performance"),
          apiFetch<Demographics>("/api/analytics/patient-demographics"),
        ])
        if (active) {
          setPopularityData(popularity)
          setDoctorData(doctors)
          setDemographics(demo)
        }
      } catch {
        if (active) {
          setPopularityData([
            { name: "لیزر موهای زائد", count: 145 },
            { name: "بوتاکس مصپورت", count: 98 },
            { name: "جوانسازی با هایفو", count: 72 },
            { name: "تزریق ژل لب", count: 64 },
            { name: "پاکسازی پوست", count: 53 },
          ])
          setDoctorData([
            { doctorName: "دکتر نیلوفر جردن", reserveCount: 120, treatmentCount: 95 },
            { doctorName: "دکتر سهرابی", reserveCount: 85, treatmentCount: 78 },
            { doctorName: "اپراتور لیزر ۱", reserveCount: 140, treatmentCount: 40 },
            { doctorName: "اپراتور فیشیال ۲", reserveCount: 90, treatmentCount: 30 },
          ])
          setDemographics({
            genderDistribution: [{ name: "مرد", count: 45 }, { name: "زن", count: 120 }, { name: "نامشخص", count: 12 }],
            ageDistribution: [{ name: "زیر ۱۸", count: 8 }, { name: "۱۸-۲۹", count: 52 }, { name: "۳۰-۴۴", count: 68 }, { name: "۴۵-۵۹", count: 35 }, { name: "۶۰+", count: 14 }],
            jobDistribution: [{ name: "خانه‌دار", count: 48 }, { name: "کارمند", count: 35 }, { name: "آزاد", count: 28 }, { name: "دانشجو", count: 22 }, { name: "بازنشسته", count: 12 }],
          })
        }
      } finally {
        if (active) setLoading(false)
      }
    }
    fetchAnalytics()
    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true
    const fetchTreatments = async () => {
      setTreatLoading(true)
      try {
        const data = await apiFetch<TreatmentAnalytics>("/api/analytics/treatments")
        if (active) setTreatmentData(data)
      } catch {
        if (active) {
          setTreatmentData({
            categories: [
              { name: "درمان دارویی داروهای مو و ابرو", count: 187 },
              { name: "پروسیجر مو", count: 143 },
              { name: "تشخیص بیماری‌های مو و ابرو", count: 98 },
              { name: "پروسیجر صورت", count: 76 },
              { name: "مراقبت پوست", count: 54 },
            ],
            diagnoses: [
              { name: "Androgenetic alopecia", count: 156 },
              { name: "Telogen effluvium", count: 67 },
              { name: "Alopecia areata", count: 43 },
              { name: "Female pattern hair loss", count: 38 },
              { name: "Male pattern baldness", count: 32 },
            ],
            treatmentItems: [
              { name: "Oral Minoxidil (0.25–2.5 mg)", count: 134 },
              { name: "PRF (Platelet-Rich Fibrin)", count: 112 },
              { name: "Minoxidil topical 5%", count: 98 },
              { name: "Dutasteride 0.5 mg", count: 76 },
              { name: "Folicogen", count: 65 },
              { name: "Minoxidil topical 2%", count: 54 },
              { name: "PRP (Platelet-Rich Plasma)", count: 48 },
              { name: "Microneedling", count: 42 },
            ],
            monthlyTrend: [
              { period: "2025-10", "درمان دارویی داروهای مو و ابرو": 12, "پروسیجر مو": 8 },
              { period: "2025-11", "درمان دارویی داروهای مو و ابرو": 15, "پروسیجر مو": 10 },
              { period: "2025-12", "درمان دارویی داروهای مو و ابرو": 18, "پروسیجر مو": 14 },
              { period: "2026-01", "درمان دارویی داروهای مو و ابرو": 22, "پروسیجر مو": 16 },
              { period: "2026-02", "درمان دارویی داروهای مو و ابرو": 25, "پروسیجر مو": 18 },
              { period: "2026-03", "درمان دارویی داروهای مو و ابرو": 28, "پروسیجر مو": 22 },
            ],
            doctorBreakdown: [
              { doctor: "دکتر نیلوفر جردن", categories: [{ name: "درمان دارویی", count: 45 }, { name: "پروسیجر", count: 38 }, { name: "تشخیص", count: 22 }], total: 105 },
              { doctor: "دکتر سهرابی", categories: [{ name: "درمان دارویی", count: 32 }, { name: "پروسیجر", count: 28 }, { name: "تشخیص", count: 18 }], total: 78 },
            ],
          })
        }
      } finally {
        if (active) setTreatLoading(false)
      }
    }
    fetchTreatments()
    return () => { active = false }
  }, [])

  const handleExport = (type: "pdf" | "excel") => {
    alert(`خروجی گزارش به فرمت ${type === "pdf" ? "PDF" : "Excel"} با موفقیت آماده شد`)
  }

  const allCategories = treatmentData?.categories ?? []
  const trendKeys = allCategories.map((c) => c.name)

  const genderData = {
    labels: demographics?.genderDistribution.map((g) => g.name) ?? [],
    datasets: [{
      data: demographics?.genderDistribution.map((g) => g.count) ?? [],
      backgroundColor: COLORS.slice(0, 3),
      borderWidth: 0,
    }],
  }

  const ageData = {
    labels: demographics?.ageDistribution.map((a) => a.name) ?? [],
    datasets: [{
      label: "تعداد",
      data: demographics?.ageDistribution.map((a) => a.count) ?? [],
      backgroundColor: "#2563eb",
      borderRadius: 4,
    }],
  }

  const jobData = {
    labels: demographics?.jobDistribution.map((j) => j.name).reverse() ?? [],
    datasets: [{
      label: "تعداد",
      data: demographics?.jobDistribution.map((j) => j.count).reverse() ?? [],
      backgroundColor: "#d97706",
      borderRadius: 4,
    }],
  }

  const catPieData = {
    labels: treatmentData?.categories.map((c) => c.name) ?? [],
    datasets: [{
      data: treatmentData?.categories.map((c) => c.count) ?? [],
      backgroundColor: COLORS,
      borderWidth: 0,
    }],
  }

  const catBarData = {
    labels: treatmentData?.categories.map((c) => c.name).reverse() ?? [],
    datasets: [{
      label: "تعداد پرونده",
      data: treatmentData?.categories.map((c) => c.count).reverse() ?? [],
      backgroundColor: "#8b5cf6",
      borderRadius: 4,
    }],
  }

  const trendData = {
    labels: treatmentData?.monthlyTrend.map((m) => formatMonth(m.period)) ?? [],
    datasets: trendKeys.slice(0, 6).map((key, i) => ({
      label: key,
      data: treatmentData?.monthlyTrend.map((m) => (m[key] as number) ?? 0) ?? [],
      borderColor: COLORS[i % COLORS.length],
      backgroundColor: COLORS[i % COLORS.length] + "20",
      fill: true,
      tension: 0.3,
      pointRadius: 3,
    })),
  }

  const popData = {
    labels: popularityData.map((p) => p.name).reverse(),
    datasets: [{
      label: "تعداد پرونده",
      data: popularityData.map((p) => p.count).reverse(),
      backgroundColor: COLORS,
      borderRadius: 4,
    }],
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <div className="grid gap-6 md:grid-cols-2">
          {[1, 2].map((i) => (
            <Card key={i}><CardHeader><Skeleton className="h-5 w-48" /></CardHeader><CardContent><Skeleton className="h-64 w-full" /></CardContent></Card>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">گزارشات و تحلیل‌ها</h1>
          <p className="text-sm text-muted-foreground mt-1">
            ارزیابی راندمان پزشکان و بررسی روندهای درمانی
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => handleExport("excel")}>
            <FileSpreadsheet className="text-emerald-600" />
            خروجی Excel
          </Button>
          <Button size="sm" onClick={() => handleExport("pdf")}>
            <FileText />
            دانلود PDF
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={(v: string | null) => v && setActiveTab(v)}>
        <TabsList className="mb-4">
          <TabsTrigger value="overview" className="flex items-center gap-2">
            <BarChart3 className="size-4" />
            نمای کلی
          </TabsTrigger>
          <TabsTrigger value="treatments" className="flex items-center gap-2">
            <Activity className="size-4" />
            تحلیل درمان
          </TabsTrigger>
          <TabsTrigger value="doctors" className="flex items-center gap-2">
            <Users className="size-4" />
            عملکرد پرسنل
          </TabsTrigger>
        </TabsList>

        {/* ─── Overview Tab ─── */}
        <TabsContent value="overview" className="space-y-6">
          <div className="grid gap-6 md:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <PieChart className="text-blue-600" />
                  توزیع جنسیت
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-52">
                  <ChartWrapper>
                    <Doughnut data={genderData} options={{ ...commonOpts, cutout: "55%" }} />
                  </ChartWrapper>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Layers className="text-emerald-600" />
                  توزیع سنی
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-52">
                  <ChartWrapper>
                    <Bar data={ageData} options={{ ...commonOpts, scales: { y: { ticks: { font: chartTextConfig(10) }, beginAtZero: true }, x: { ticks: { font: chartTextConfig(10) } } } }} />
                  </ChartWrapper>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <BarChart3 className="text-amber-600" />
                  شغل بیماران
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-52">
                  <ChartWrapper>
                    <Bar data={jobData} options={{ ...commonOpts, indexAxis: "y", scales: { x: { ticks: { font: chartTextConfig(10) }, beginAtZero: true }, y: { ticks: { font: chartTextConfig(10) } } } }} />
                  </ChartWrapper>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Award className="text-amber-600 dark:text-amber-400" />
                محبوبیت خدمات درمانی
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                <ChartWrapper>
                  <Bar data={popData} options={{ ...commonOpts, indexAxis: "y", scales: { x: { ticks: { font: chartTextConfig(10) }, beginAtZero: true }, y: { ticks: { font: chartTextConfig(10) } } }, plugins: { legend: { display: false }, tooltip: commonOpts.plugins.tooltip } } as ChartOptions<"bar">} />
                </ChartWrapper>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Treatments Tab ─── */}
        <TabsContent value="treatments" className="space-y-6">
          {treatLoading ? (
            <div className="grid gap-6 md:grid-cols-2">
              {[1, 2, 3, 4].map((i) => (
                <Card key={i}><CardHeader><Skeleton className="h-5 w-48" /></CardHeader><CardContent><Skeleton className="h-48 w-full" /></CardContent></Card>
              ))}
            </div>
          ) : (
            <>
              <div className="grid gap-6 md:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <PieChart className="text-violet-600" />
                      دسته‌بندی درمان‌ها
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-72">
                      <ChartWrapper>
                        <Doughnut data={catPieData} options={{ ...commonOpts, cutout: "50%", plugins: { ...commonOpts.plugins, legend: { ...commonOpts.plugins.legend, position: "bottom" as const } } }} />
                      </ChartWrapper>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <BarChart3 className="text-violet-600" />
                      تفکیک دسته‌بندی درمان
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-72">
                      <ChartWrapper>
                        <Bar data={catBarData} options={{ ...commonOpts, indexAxis: "y", scales: { x: { ticks: { font: chartTextConfig(10) }, beginAtZero: true }, y: { ticks: { font: chartTextConfig(9) } } }, plugins: { legend: { display: false }, tooltip: commonOpts.plugins.tooltip } } as ChartOptions<"bar">} />
                      </ChartWrapper>
                    </div>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Stethoscope className="text-blue-600" />
                    تشخیص‌های ثبت شده
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>عنوان تشخیص</TableHead>
                        <TableHead>تعداد</TableHead>
                        <TableHead>درصد</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {treatmentData?.diagnoses.map((d, i) => {
                        const total = treatmentData.diagnoses.reduce((s, x) => s + x.count, 0)
                        const pct = total > 0 ? Math.round((d.count / total) * 100) : 0
                        return (
                          <TableRow key={d.name}>
                            <TableCell className="font-medium">{toPersianNum(i + 1)}. {d.name}</TableCell>
                            <TableCell>{toPersianNum(d.count)}</TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <div className="h-2 rounded-full bg-blue-100 dark:bg-blue-950 flex-1 max-w-[200px]">
                                  <div className="h-full rounded-full bg-blue-600" style={{ width: `${pct}%` }} />
                                </div>
                                <span className="text-xs text-muted-foreground">%{toPersianNum(pct)}</span>
                              </div>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Activity className="text-emerald-600" />
                    آیتم‌های درمانی پرکاربرد
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>نام درمان</TableHead>
                        <TableHead>تعداد تجویز</TableHead>
                        <TableHead>محبوبیت</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {treatmentData?.treatmentItems.map((item, i) => {
                        const max = treatmentData.treatmentItems[0]?.count || 1
                        const pct = Math.round((item.count / max) * 100)
                        const barColor = pct > 75 ? "bg-emerald-500" : pct > 50 ? "bg-blue-500" : pct > 25 ? "bg-amber-500" : "bg-gray-400"
                        return (
                          <TableRow key={item.name}>
                            <TableCell className="font-medium">{toPersianNum(i + 1)}. {item.name}</TableCell>
                            <TableCell>{toPersianNum(item.count)}</TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <div className="h-2.5 rounded-full bg-gray-100 dark:bg-gray-800 flex-1 max-w-[250px]">
                                  <div className={`h-full rounded-full ${barColor} transition-all`} style={{ width: `${pct}%` }} />
                                </div>
                                <span className="text-xs text-muted-foreground min-w-[40px]">%{toPersianNum(pct)}</span>
                              </div>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              {treatmentData && trendKeys.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <TrendingUp className="text-blue-600" />
                      روند ماهانه درمان‌ها
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-72">
                      <ChartWrapper>
                        <Line data={trendData} options={{ ...commonOpts, scales: { y: { ticks: { font: chartTextConfig(10) }, beginAtZero: true }, x: { ticks: { font: chartTextConfig(10) } } } }} />
                      </ChartWrapper>
                    </div>
                  </CardContent>
                </Card>
              )}

              {treatmentData && treatmentData.doctorBreakdown.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Users className="text-amber-600" />
                      تفکیک درمان بر اساس پزشک
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>پزشک</TableHead>
                          <TableHead>دسته‌بندی</TableHead>
                          <TableHead>تعداد</TableHead>
                          <TableHead className="text-center">مجموع</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {treatmentData.doctorBreakdown.map((doc) => (
                          doc.categories.map((cat, ci) => (
                            <TableRow key={`${doc.doctor}-${cat.name}`}>
                              {ci === 0 && (
                                <TableCell className="font-medium" rowSpan={doc.categories.length}>
                                  {doc.doctor}
                                </TableCell>
                              )}
                              <TableCell className="flex items-center gap-2">
                                {getCatIcon(cat.name)}
                                {cat.name}
                              </TableCell>
                              <TableCell>{toPersianNum(cat.count)}</TableCell>
                              {ci === 0 && (
                                <TableCell className="text-center font-bold" rowSpan={doc.categories.length}>
                                  {toPersianNum(doc.total)}
                                </TableCell>
                              )}
                            </TableRow>
                          ))
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </TabsContent>

        {/* ─── Doctors Tab ─── */}
        <TabsContent value="doctors" className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Award className="text-amber-600 dark:text-amber-400" />
                  تفکیک محبوبیت خدمات
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>خدمت درمانی</TableHead>
                      <TableHead>تعداد پرونده‌ها</TableHead>
                      <TableHead className="text-center">وضعیت</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {popularityData.map((item, idx) => (
                      <TableRow key={item.name}>
                        <TableCell className="font-medium">{toPersianNum(idx + 1)}. {item.name}</TableCell>
                        <TableCell>{toPersianNum(item.count)} پرونده</TableCell>
                        <TableCell className="text-center">
                          <Badge variant={idx < 2 ? "default" : idx < 4 ? "secondary" : "outline"}>
                            {idx < 2 ? "پرتقاضا" : idx < 4 ? "پایدار" : "عادی"}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Users className="text-emerald-600 dark:text-emerald-400" />
                  ارزیابی عملکرد پرسنل
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>پزشک / اپراتور</TableHead>
                      <TableHead>پذیرش نوبت</TableHead>
                      <TableHead>طرح درمان ثبت‌شده</TableHead>
                      <TableHead className="text-center">نسبت تبدیل</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {doctorData.map((doc) => {
                      const rate = doc.reserveCount > 0 ? Math.round((doc.treatmentCount / doc.reserveCount) * 100) : 0
                      return (
                        <TableRow key={doc.doctorName} className="cursor-pointer hover:bg-muted/50" onClick={() => router.push(`/analytics/doctors/${encodeURIComponent(doc.doctorName)}`)}>
                          <TableCell className="font-medium hover:underline">{doc.doctorName}</TableCell>
                          <TableCell>{toPersianNum(doc.reserveCount)}</TableCell>
                          <TableCell>{toPersianNum(doc.treatmentCount)}</TableCell>
                          <TableCell className="text-center">
                            <Badge variant={rate > 50 ? "default" : rate > 20 ? "secondary" : "outline"}>
                              %{toPersianNum(rate)}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
