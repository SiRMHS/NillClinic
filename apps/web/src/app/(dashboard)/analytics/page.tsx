"use client"

import { useCallback, useEffect, useState } from "react"
import { apiFetch } from "@/lib/api-client"
import { formatCount, formatPercent, formatRial, formatRialExact, toPersianNum, formatJalaliPeriod } from "@/lib/format"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { SortableHead, useSortableRows } from "@/components/ui/sortable-table"
import Link from "next/link"
import {
  AlertTriangle, CalendarCheck, Megaphone, RefreshCw, TrendingUp, Users, Info,
} from "lucide-react"

interface AcquisitionChannel {
  introductionId: number | null
  channel: string
  patients: number
  payingPatients: number
  activationRate: number
  revenue: number
  revenuePerPatient: number
  revenuePerPayingPatient: number
}
interface DemographicValue {
  bucket: string
  patients: number
  payingPatients: number
  revenue: number
  averageSpend: number
  revenueShare: number
}
interface AcquisitionCohort {
  cohort: string
  newPatients: number
  returnedPatients: number
  returnRate: number
  revenue: number
  revenuePerPatient: number
}
interface BookingFollowThrough {
  totalReserves: number
  acceptedReserves: number
  acceptanceRate: number
  matchedReserves: number
  matchableReserves: number
  followThroughRate: number
  unidentifiedReserves: number
}
interface PlanCoverage {
  plans: number
  planPatients: number
  billedPatients: number
  coverageRate: number
  oldestPlanDate: string | null
  newestPlanDate: string | null
}
interface MedicalMatrix {
  diagnoses: string[]
  treatments: string[]
  diagnosisDetails: { diagnosis: string; total: number; treatments: { name: string; count: number }[] }[]
  treatmentDetails: { treatment: string; total: number; diagnoses: { diagnosis: string; count: number }[] }[]
}
interface Coverage {
  syncComplete: boolean
  oldestReceptionDate: string | null
  newestReceptionDate: string | null
  syncCursorDate: string | null
  receptionCount: number
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

function RateBar({ value, tone = "emerald" }: { value: number; tone?: "emerald" | "amber" }) {
  const pct = Math.max(0, Math.min(1, value)) * 100
  return (
    // inline-flex, not flex: a block-level flex box positions itself and
    // ignores the cell's text alignment, so the bar drifted out from under its
    // header (which is an inline-flex button obeying the same `text-left`).
    <span className="inline-flex items-center gap-2 align-middle">
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
        <span className={`block h-full ${tone === "amber" ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${pct}%` }} />
      </span>
      <span className="w-11 text-left tabular-nums">{formatPercent(value, 0)}</span>
    </span>
  )
}

export default function AnalyticsPage() {
  const [channels, setChannels] = useState<AcquisitionChannel[]>([])
  const [demo, setDemo] = useState<{ gender: DemographicValue[]; age: DemographicValue[] } | null>(null)
  const [cohorts, setCohorts] = useState<AcquisitionCohort[]>([])
  const [booking, setBooking] = useState<BookingFollowThrough | null>(null)
  const [planCoverage, setPlanCoverage] = useState<PlanCoverage | null>(null)
  const [coverage, setCoverage] = useState<Coverage | null>(null)
  const [matrix, setMatrix] = useState<MedicalMatrix | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [ch, dm, co, bk, pc, cov, mx] = await Promise.all([
        apiFetch<AcquisitionChannel[]>("/api/analytics/acquisition-channels"),
        apiFetch<{ gender: DemographicValue[]; age: DemographicValue[] }>("/api/analytics/demographic-value"),
        apiFetch<AcquisitionCohort[]>("/api/analytics/cohorts?limit=24"),
        apiFetch<BookingFollowThrough>("/api/analytics/booking-follow-through"),
        apiFetch<PlanCoverage>("/api/analytics/treatment-plan-coverage"),
        apiFetch<Coverage>("/api/visitors/coverage"),
        apiFetch<MedicalMatrix>("/api/analytics/medical-matrix"),
      ])
      setChannels(ch)
      setDemo(dm)
      setCohorts(co)
      setBooking(bk)
      setPlanCoverage(pc)
      setCoverage(cov)
      setMatrix(mx)
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطا در دریافت تحلیل‌ها")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const chSort = useSortableRows(
    channels,
    {
      channel: (r) => r.channel,
      patients: (r) => r.patients,
      paying: (r) => r.payingPatients,
      activation: (r) => r.activationRate,
      revenue: (r) => r.revenue,
      perPatient: (r) => r.revenuePerPatient,
    },
    { key: "revenue", direction: "desc" },
  )

  const best = channels.filter((c) => c.introductionId !== null && c.patients >= 500)
  const bestChannel = [...best].sort((a, b) => b.revenuePerPatient - a.revenuePerPatient)[0]
  const worstChannel = [...best].sort((a, b) => a.activationRate - b.activationRate)[0]

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6" dir="rtl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">تحلیل‌ها</h1>
          <p className="text-sm text-muted-foreground">
            هر گروه از مراجعین چقدر می‌ارزد — کانال جذب، جمعیت‌شناسی، کوهورت و پیگیری نوبت
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
          بازخوانی
        </Button>
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
              <span className="font-medium">سینک پذیرش‌ها کامل نشده</span> — ارقام مالی و کوهورت‌ها
              فقط بازه سینک‌شده را پوشش می‌دهند.
              <div className="mt-1 text-xs text-muted-foreground">
                {coverage.oldestReceptionDate ? toPersianNum(coverage.oldestReceptionDate) : "—"} تا{" "}
                {coverage.newestReceptionDate ? toPersianNum(coverage.newestReceptionDate) : "—"} ·{" "}
                {formatCount(coverage.receptionCount)} پذیرش
                {coverage.syncCursorDate ? ` · سینک تا ${toPersianNum(coverage.syncCursorDate)}` : ""}
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {loading && channels.length === 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="پربازده‌ترین کانال"
              value={bestChannel?.channel ?? "—"}
              hint={bestChannel ? `${formatRial(bestChannel.revenuePerPatient)} درآمد به ازای هر جذب` : undefined}
              icon={<Megaphone className="size-4" />}
              tone="positive"
            />
            <Stat
              label="ضعیف‌ترین تبدیل کانال"
              value={worstChannel?.channel ?? "—"}
              hint={worstChannel ? `فقط ${formatPercent(worstChannel.activationRate, 0)} به بیمار پرداخت‌کننده تبدیل شده` : undefined}
              icon={<Megaphone className="size-4" />}
              tone="warning"
            />
            <Stat
              label="پیگیری نوبت"
              value={booking ? formatPercent(booking.followThroughRate, 0) : "—"}
              hint={booking ? `${formatCount(booking.matchedReserves)} از ${formatCount(booking.matchableReserves)} نوبت گذشته به پذیرش رسید` : undefined}
              icon={<CalendarCheck className="size-4" />}
              tone={booking && booking.followThroughRate < 0.5 ? "warning" : undefined}
            />
            <Stat
              label="نوبت بدون کد بیمار"
              value={booking ? formatCount(booking.unidentifiedReserves) : "—"}
              hint={booking ? `${formatPercent(booking.totalReserves > 0 ? booking.unidentifiedReserves / booking.totalReserves : 0, 0)} از نوبت‌ها قابل انتساب نیستند` : undefined}
              icon={<Users className="size-4" />}
              tone="danger"
            />
          </div>

          <Tabs defaultValue="channels">
            <TabsList>
              <TabsTrigger value="channels">کانال جذب</TabsTrigger>
              <TabsTrigger value="demographics">ارزش مراجعین</TabsTrigger>
              <TabsTrigger value="cohorts">کوهورت و بازگشت</TabsTrigger>
              <TabsTrigger value="booking">پیگیری نوبت</TabsTrigger>
              <TabsTrigger value="clinical">بالینی</TabsTrigger>
            </TabsList>

            <TabsContent value="channels">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">بازدهی کانال‌های جذب</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    «تعداد بیمار» و «درآمد» یک چیز نیستند: کانالی می‌تواند بیشترین مراجع را بیاورد و
                    کمترین بازده را داشته باشد. ستون «درآمد هر جذب» ملاک تصمیم است.
                  </p>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <SortableHead label="کانال" sortKey="channel" sort={chSort.sort} onSort={chSort.toggle} defaultDirection="asc" />
                          <SortableHead label="بیمار جذب‌شده" sortKey="patients" sort={chSort.sort} onSort={chSort.toggle} align="left" />
                          <SortableHead label="پرداخت‌کننده" sortKey="paying" sort={chSort.sort} onSort={chSort.toggle} align="left" />
                          <SortableHead label="نرخ فعال‌سازی" sortKey="activation" sort={chSort.sort} onSort={chSort.toggle} align="left" />
                          <SortableHead label="کل درآمد" sortKey="revenue" sort={chSort.sort} onSort={chSort.toggle} align="left" />
                          <SortableHead label="درآمد هر جذب" sortKey="perPatient" sort={chSort.sort} onSort={chSort.toggle} align="left" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {chSort.sorted.map((c) => (
                          <TableRow key={c.introductionId ?? "none"}>
                            <TableCell className="font-medium">{c.channel}</TableCell>
                            <TableCell className="text-left tabular-nums">{formatCount(c.patients)}</TableCell>
                            <TableCell className="text-left tabular-nums">{formatCount(c.payingPatients)}</TableCell>
                            <TableCell className="text-left"><RateBar value={c.activationRate} /></TableCell>
                            <TableCell className="text-left tabular-nums" title={formatRialExact(c.revenue)}>{formatRial(c.revenue)}</TableCell>
                            <TableCell className="text-left font-medium tabular-nums">{formatRial(c.revenuePerPatient)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="demographics">
              <div className="grid gap-4 lg:grid-cols-2">
                <DemoCard title="ارزش بر اساس جنسیت" rows={demo?.gender ?? []} />
                <DemoCard title="ارزش بر اساس گروه سنی" rows={demo?.age ?? []} />
              </div>
            </TabsContent>

            <TabsContent value="cohorts">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">کوهورت جذب</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    بیماران بر اساس ماه اولین مراجعه پولی گروه‌بندی شده‌اند: هر ماه چند بیمار جدید
                    آمد و چه سهمی از آن‌ها دوباره برگشت.
                  </p>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>ماه</TableHead>
                          <TableHead className="text-left">بیمار جدید</TableHead>
                          <TableHead className="text-left">بازگشته</TableHead>
                          <TableHead className="text-left">نرخ بازگشت</TableHead>
                          <TableHead className="text-left">درآمد</TableHead>
                          <TableHead className="text-left">درآمد هر بیمار</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {cohorts.map((c) => (
                          <TableRow key={c.cohort}>
                            <TableCell className="font-medium">{formatJalaliPeriod(c.cohort)}</TableCell>
                            <TableCell className="text-left tabular-nums">{formatCount(c.newPatients)}</TableCell>
                            <TableCell className="text-left tabular-nums">{formatCount(c.returnedPatients)}</TableCell>
                            <TableCell className="text-left"><RateBar value={c.returnRate} /></TableCell>
                            <TableCell className="text-left tabular-nums" title={formatRialExact(c.revenue)}>{formatRial(c.revenue)}</TableCell>
                            <TableCell className="text-left tabular-nums">{formatRial(c.revenuePerPatient)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="booking">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">نوبت تا پذیرش</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {booking ? (
                    <>
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <Stat label="کل نوبت‌ها" value={formatCount(booking.totalReserves)} />
                        <Stat label="نوبت پذیرش‌شده (پرچم CRM)" value={formatCount(booking.acceptedReserves)} hint={formatPercent(booking.acceptanceRate, 0)} />
                        <Stat label="نوبت گذشته قابل بررسی" value={formatCount(booking.matchableReserves)} hint="دارای کد بیمار و تاریخ گذشته" />
                        <Stat label="رسیده به پذیرش" value={formatCount(booking.matchedReserves)} hint={formatPercent(booking.followThroughRate, 0)} tone="positive" />
                      </div>
                      <div className="flex items-start gap-2 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                        <Info className="mt-0.5 size-3.5 shrink-0" />
                        <span>
                          «رسیده به پذیرش» نوبت را با پذیرشِ همان بیمار در همان روز تطبیق می‌دهد، پس
                          یک <b>کف</b> است نه نرخ دقیق عدم‌حضور: بیماری که جابه‌جا کرده و روز دیگری
                          آمده، تطبیق نمی‌خورد. ضمناً {formatCount(booking.unidentifiedReserves)} نوبت
                          اصلاً کد بیمار ندارند و از محاسبه کنار گذاشته شده‌اند.
                        </span>
                      </div>
                    </>
                  ) : null}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="clinical">
              <div className="space-y-4">
                {planCoverage ? (
                  <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs dark:border-amber-900 dark:bg-amber-950/40">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                    <span>
                      طرح‌های درمانی فقط{" "}
                      <b>
                        {formatCount(planCoverage.plans)} طرح برای{" "}
                        {formatCount(planCoverage.planPatients)} بیمار
                      </b>{" "}
                      ثبت شده‌اند — یعنی <b>{formatPercent(planCoverage.coverageRate, 1)}</b> از{" "}
                      {formatCount(planCoverage.billedPatients)} بیمار دارای سابقه مالی، و محدود به
                      بازه {planCoverage.oldestPlanDate ? toPersianNum(planCoverage.oldestPlanDate) : "—"} تا{" "}
                      {planCoverage.newestPlanDate ? toPersianNum(planCoverage.newestPlanDate) : "—"}.
                      این بخش نماینده کل کلینیک نیست.
                    </span>
                  </div>
                ) : null}

                <div className="grid gap-4 sm:grid-cols-3">
                  <Stat label="تشخیص منحصربه‌فرد" value={formatCount(matrix?.diagnoses.length ?? 0)} icon={<TrendingUp className="size-4" />} />
                  <Stat label="آیتم درمانی منحصربه‌فرد" value={formatCount(matrix?.treatments.length ?? 0)} />
                  <Stat label="طرح درمانی" value={formatCount(planCoverage?.plans ?? 0)} />
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">پرتکرارترین تشخیص → درمان</CardTitle>
                      <p className="text-xs text-muted-foreground">
                        برای هر تشخیص، رایج‌ترین آیتم درمانی تجویزشده
                      </p>
                    </CardHeader>
                    <CardContent className="p-0">
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>تشخیص</TableHead>
                              <TableHead>رایج‌ترین درمان</TableHead>
                              <TableHead className="text-left">دفعات</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {(matrix?.diagnosisDetails ?? [])
                              .slice(0, 12)
                              .map((d) => (
                                <TableRow key={d.diagnosis}>
                                  <TableCell className="font-medium">{d.diagnosis}</TableCell>
                                  <TableCell className="text-xs">
                                    {d.treatments[0]?.name ?? "—"}
                                  </TableCell>
                                  <TableCell className="text-left tabular-nums">
                                    {formatCount(d.treatments[0]?.count ?? 0)}
                                    <span className="text-muted-foreground"> / {formatCount(d.total)}</span>
                                  </TableCell>
                                </TableRow>
                              ))}
                          </TableBody>
                        </Table>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">پرکاربردترین آیتم‌های درمانی</CardTitle>
                      <p className="text-xs text-muted-foreground">
                        و شایع‌ترین تشخیصی که به آن منجر شده
                      </p>
                    </CardHeader>
                    <CardContent className="p-0">
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>آیتم درمانی</TableHead>
                              <TableHead>شایع‌ترین تشخیص</TableHead>
                              <TableHead className="text-left">دفعات</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {(matrix?.treatmentDetails ?? [])
                              .slice(0, 12)
                              .map((t) => (
                                <TableRow key={t.treatment}>
                                  <TableCell className="font-medium">{t.treatment}</TableCell>
                                  <TableCell className="text-xs">
                                    {t.diagnoses[0]?.diagnosis ?? "—"}
                                  </TableCell>
                                  <TableCell className="text-left tabular-nums">
                                    {formatCount(t.total)}
                                  </TableCell>
                                </TableRow>
                              ))}
                          </TableBody>
                        </Table>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                <Link href="/analytics/medical" className="inline-flex text-sm text-primary underline underline-offset-4">
                  کاوش تعاملی کامل تشخیص ↔ درمان
                </Link>
              </div>
            </TabsContent>
          </Tabs>

          <p className="text-xs text-muted-foreground">
            محبوبیت خدمات و رتبه‌بندی پزشکان از این صفحه حذف شد چون در{" "}
            <Link href="/crm" className="text-primary underline underline-offset-4">تحلیل مراجعین</Link>{" "}
            بر پایه پذیرش‌های واقعی و با درآمد، نرخ بازگشت و نرخ تبدیل ارائه می‌شود. گزارش‌های مالی در{" "}
            <Link href="/financial" className="text-primary underline underline-offset-4">تحلیل مالی</Link> است.
          </p>
        </>
      )}
    </div>
  )
}

function DemoCard({ title, rows }: { title: string; rows: DemographicValue[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <p className="text-xs text-muted-foreground">
          نه فقط تعداد — میانگین خرج هر گروه و سهمش از درآمد
        </p>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>گروه</TableHead>
                <TableHead className="text-left">بیماران</TableHead>
                <TableHead className="text-left">میانگین خرج</TableHead>
                <TableHead className="text-left">سهم درآمد</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.bucket}>
                  <TableCell className="font-medium">{r.bucket}</TableCell>
                  <TableCell className="text-left tabular-nums">{formatCount(r.patients)}</TableCell>
                  <TableCell className="text-left tabular-nums" title={formatRialExact(r.averageSpend)}>
                    {formatRial(r.averageSpend)}
                  </TableCell>
                  <TableCell className="text-left"><RateBar value={r.revenueShare} tone="amber" /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}
