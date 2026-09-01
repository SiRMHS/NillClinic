"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { apiFetch } from "@/lib/api-client"
import { jalaliToday, jalaliYearRange } from "@jordan/shared"
import { useAuth } from "@/stores/auth.store"
import {
  formatCount, formatPercent, formatRial, formatRialExact, formatJalaliPeriod, toPersianNum,
} from "@/lib/format"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { PatientDetailDialog } from "@/components/patient-detail-dialog"
import {
  AlertTriangle, ArrowLeft, Banknote, CalendarCheck, ChevronLeft, Crown,
  PhoneCall, RefreshCw, Repeat, TrendingUp, Users,
} from "lucide-react"

interface RevenueSummary {
  totalReceived: number
  totalDiscount: number
  totalOutstanding: number
  receptionCount: number
  uniquePatients: number
  averageTicket: number
  discountRate: number
}
interface RevenuePoint { period: string; received: number; receptionCount: number }
interface SegmentSummary {
  segment: string
  segmentLabel: string
  patientCount: number
  totalReceived: number
  revenueShare: number
}
interface FollowUpCandidate {
  patientExternalCode: number
  fullName: string | null
  mobile: string | null
  lastVisitDate: string | null
  daysSinceLastVisit: number
  visitCount: number
  totalReceived: number
}
interface Coverage {
  syncComplete: boolean
  syncStatus: string
  oldestReceptionDate: string | null
  newestReceptionDate: string | null
  receptionCount: number
  metricsComputedAt: string | null
  rankedPatients: number
}
interface ConversionSummary { conversionRate: number; consultedPatients: number; convertedPatients: number }
interface RetentionSummary { returnRate: number; totalPatients: number; singleVisitPatients: number }
interface TopService { serviceName: string; receptionCount: number; revenue: number }

function Kpi({
  label, value, hint, icon, href, tone,
}: {
  label: string
  value: string
  hint?: string
  icon: React.ReactNode
  href?: string
  tone?: "positive" | "warning" | "danger"
}) {
  const toneClass =
    tone === "positive" ? "text-emerald-600 dark:text-emerald-400"
    : tone === "warning" ? "text-amber-600 dark:text-amber-400"
    : tone === "danger" ? "text-rose-600 dark:text-rose-400"
    : ""

  const body = (
    <Card className={href ? "transition-colors hover:border-primary/50" : undefined}>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <span className="text-muted-foreground">{icon}</span>
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold tabular-nums ${toneClass}`}>{value}</div>
        {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  )

  return href ? <Link href={href}>{body}</Link> : body
}

/** Pure-CSS sparkline: a bar per period, no chart library on the landing page. */
function MiniTrend({ points }: { points: RevenuePoint[] }) {
  if (points.length === 0) return null
  const max = Math.max(...points.map((p) => p.received), 1)
  return (
    <div className="flex h-24 items-end gap-1" dir="ltr">
      {points.map((p) => (
        <div
          key={p.period}
          className="group relative flex-1 rounded-t bg-primary/70 transition-colors hover:bg-primary"
          style={{ height: `${Math.max(4, (p.received / max) * 100)}%` }}
          title={`${formatJalaliPeriod(p.period)}: ${formatRialExact(p.received)}`}
        />
      ))}
    </div>
  )
}

export default function DashboardPage() {
  const user = useAuth((s) => s.user)
  // The dashboard leads with revenue, which is now its own access key. Rather
  // than let those panels fail with a 403 and blank the whole page, the ones
  // that need money are skipped for roles that cannot see it.
  const permissions = user?.permissions
  const canSeeMoney = !!permissions?.some((p) => p === "*" || p === "financial")
  const canSeeRanking = !!permissions?.some((p) => p === "*" || p === "financial.patients")
  const [summary, setSummary] = useState<RevenueSummary | null>(null)
  /**
   * All-time totals, kept alongside the year's.
   *
   * Outstanding balance is a stock, not a flow: what patients still owe does not
   * stop being owed because it was billed last year. Scoping that tile to the
   * current year would quietly understate the debt, so it keeps reading the
   * unbounded figure while the revenue tile above it reads the year's.
   */
  const [allTime, setAllTime] = useState<RevenueSummary | null>(null)
  const [trend, setTrend] = useState<RevenuePoint[]>([])
  const [segments, setSegments] = useState<SegmentSummary[]>([])
  const [followUp, setFollowUp] = useState<FollowUpCandidate[]>([])
  const [coverage, setCoverage] = useState<Coverage | null>(null)
  const [conversion, setConversion] = useState<ConversionSummary | null>(null)
  const [retention, setRetention] = useState<RetentionSummary | null>(null)
  const [topServices, setTopServices] = useState<TopService[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const year = new URLSearchParams(jalaliYearRange()).toString()
      const [s, all, t, seg, fu, cov, conv, ret, svc] = await Promise.all([
        // Bounded to the current Jalali year. "درآمد کل" was the sum of every
        // reception ever synced, which grows monotonically and therefore says
        // nothing about how the clinic is doing — and it moved whenever the
        // sync reached further back, which read as the figure being unstable.
        canSeeMoney ? apiFetch<RevenueSummary>(`/api/financial/summary?${year}`) : null,
        canSeeMoney ? apiFetch<RevenueSummary>("/api/financial/summary") : null,
        canSeeMoney ? apiFetch<RevenuePoint[]>("/api/financial/trend?granularity=month") : [],
        canSeeRanking ? apiFetch<SegmentSummary[]>("/api/financial/patients/segments") : [],
        apiFetch<{ candidates: FollowUpCandidate[] }>("/api/visitors/follow-up?minDays=180&limit=8"),
        apiFetch<Coverage>("/api/visitors/coverage"),
        apiFetch<{ summary: ConversionSummary }>("/api/visitors/conversion"),
        apiFetch<{ summary: RetentionSummary }>("/api/visitors/retention"),
        apiFetch<{ top: TopService[] }>("/api/visitors/services?limit=5&kind=procedure"),
      ])
      setSummary(s)
      setAllTime(all)
      setTrend(t.slice(-12))
      setSegments(seg)
      setFollowUp(fu.candidates)
      setCoverage(cov)
      setConversion(conv.summary)
      setRetention(ret.summary)
      setTopServices(svc.top)
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطا در دریافت اطلاعات داشبورد")
    } finally {
      setLoading(false)
    }
  }, [canSeeMoney, canSeeRanking])

  useEffect(() => {
    void load()
  }, [load])

  const atRisk = segments.find((s) => s.segment === "AT_RISK")
  const champions = segments.find((s) => s.segment === "CHAMPION")
  const lastMonth = trend.at(-1)
  const prevMonth = trend.at(-2)
  const monthDelta =
    lastMonth && prevMonth && prevMonth.received > 0
      ? (lastMonth.received - prevMonth.received) / prevMonth.received
      : null

  const firstName = user?.fullName?.split(" ")[0] ?? ""
  const currentJalaliYear = jalaliToday().slice(0, 4)

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6" dir="rtl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">
            {firstName ? `سلام ${firstName}` : "داشبورد"}
          </h1>
          <p className="text-sm text-muted-foreground">
            وضعیت کلینیک در یک نگاه — و کاری که همین امروز می‌شود انجام داد
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
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <span>
                سینک پذیرش‌ها کامل نیست ({coverage.syncStatus}) — اعداد زیر فقط بازه سینک‌شده را
                پوشش می‌دهند.
              </span>
            </div>
            <Link href="/sync">
              <Button size="sm" variant="outline">وضعیت سینک <ChevronLeft className="size-4" /></Button>
            </Link>
          </CardContent>
        </Card>
      ) : null}

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}
        </div>
      ) : (
        <>
          {/* Money first: what the clinic earned and what it is owed. */}
          {canSeeMoney && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi
              label={`درآمد امسال (${formatJalaliPeriod(currentJalaliYear)})`}
              value={summary ? formatRial(summary.totalReceived) : "—"}
              hint={summary ? formatRialExact(summary.totalReceived) : undefined}
              icon={<Banknote className="size-4" />}
              tone="positive"
              href="/financial"
            />
            <Kpi
              label="درآمد ماه اخیر"
              value={lastMonth ? formatRial(lastMonth.received) : "—"}
              hint={
                monthDelta !== null
                  ? `${monthDelta >= 0 ? "▲" : "▼"} ${formatPercent(Math.abs(monthDelta), 0)} نسبت به ماه قبل`
                  : lastMonth ? formatJalaliPeriod(lastMonth.period) : undefined
              }
              icon={<TrendingUp className="size-4" />}
              tone={monthDelta !== null && monthDelta < 0 ? "warning" : "positive"}
              href="/financial"
            />
            <Kpi
              label="مانده دریافت‌نشده"
              value={allTime ? formatRial(allTime.totalOutstanding) : "—"}
              hint="بدهی باقیمانده بیماران — کل دوره"
              icon={<Banknote className="size-4" />}
              tone={allTime && allTime.totalOutstanding > 0 ? "danger" : undefined}
              href="/financial"
            />
            <Kpi
              label="میانگین هر پذیرش"
              value={summary ? formatRial(summary.averageTicket) : "—"}
              hint={summary ? `${formatCount(summary.receptionCount)} پذیرش امسال` : undefined}
              icon={<CalendarCheck className="size-4" />}
            />
          </div>
          )}

          <div className="grid gap-4 lg:grid-cols-3">
            {canSeeMoney && (
            <Card className="lg:col-span-2">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">روند درآمد ۱۲ ماه اخیر</CardTitle>
                <Link href="/financial" className="text-xs text-primary underline underline-offset-4">
                  جزئیات مالی
                </Link>
              </CardHeader>
              <CardContent>
                <MiniTrend points={trend} />
                <div className="mt-2 flex justify-between text-xs text-muted-foreground">
                <span>{lastMonth ? formatJalaliPeriod(lastMonth.period) : ""}</span>

                  <span>{trend[0] ? formatJalaliPeriod(trend[0].period) : ""}</span>
                </div>
              </CardContent>
            </Card>
            )}

            {/* The single most actionable panel on the page. */}
            <Card className={canSeeMoney ? "border-amber-300/60 dark:border-amber-900/60" : "border-amber-300/60 dark:border-amber-900/60 lg:col-span-3"}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <PhoneCall className="size-4 text-amber-600" />
                  اقدام امروز
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {canSeeRanking && (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">در خطر ریزش</span>
                      <span className="font-bold tabular-nums">
                        {atRisk ? formatCount(atRisk.patientCount) : "—"} بیمار
                      </span>
                    </div>
                    {atRisk ? (
                      <p className="text-xs text-muted-foreground">
                        این گروه {formatPercent(atRisk.revenueShare)} درآمد کلینیک را ساخته و مدتی است
                        مراجعه نکرده. بازگرداندنشان ارزان‌تر از جذب بیمار جدید است.
                      </p>
                    ) : null}
                    <Link href="/financial/patients?segment=AT_RISK" className="block">
                      <Button size="sm" className="w-full">
                        مشاهده فهرست <ArrowLeft className="size-4" />
                      </Button>
                    </Link>
                  </>
                )}
                <Link href="/crm" className="block">
                  <Button size="sm" variant="outline" className="w-full">
                    فهرست پیگیری ({formatCount(followUp.length)}+)
                  </Button>
                </Link>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi
              label="نرخ تبدیل"
              value={conversion ? formatPercent(conversion.conversionRate) : "—"}
              hint={conversion ? `${formatCount(conversion.convertedPatients)} از ${formatCount(conversion.consultedPatients)}` : undefined}
              icon={<TrendingUp className="size-4" />}
              href="/crm"
            />
            <Kpi
              label="نرخ بازگشت"
              value={retention ? formatPercent(retention.returnRate) : "—"}
              hint={retention ? `${formatCount(retention.singleVisitPatients)} نفر فقط یک بار آمده‌اند` : undefined}
              icon={<Repeat className="size-4" />}
              href="/crm"
            />
            {canSeeRanking && (
              <Kpi
                label="بیماران ویژه"
                value={champions ? formatCount(champions.patientCount) : "—"}
                hint={champions ? `${formatPercent(champions.revenueShare)} از کل درآمد` : undefined}
                icon={<Crown className="size-4" />}
                tone="positive"
                href="/financial/patients?segment=CHAMPION"
              />
            )}
            {canSeeRanking && (
              <Kpi
                label="بیماران رتبه‌بندی‌شده"
                value={coverage ? formatCount(coverage.rankedPatients) : "—"}
                hint={allTime ? `${formatCount(allTime.uniquePatients)} بیمار با سابقه مالی` : undefined}
                icon={<Users className="size-4" />}
                href="/financial/patients"
              />
            )}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">بیماران نیازمند پیگیری</CardTitle>
                <Link href="/crm" className="text-xs text-primary underline underline-offset-4">همه</Link>
              </CardHeader>
              <CardContent className="p-0">
                {followUp.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    موردی برای پیگیری نیست.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>بیمار</TableHead>
                          <TableHead className="text-left">آخرین مراجعه</TableHead>
                          <TableHead className="text-left">ارزش</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {followUp.map((c) => (
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
                            <TableCell className="text-left">
                              <Badge variant="secondary">
                                {toPersianNum(Math.round(c.daysSinceLastVisit / 30))} ماه پیش
                              </Badge>
                            </TableCell>
                            <TableCell className="text-left tabular-nums" title={formatRialExact(c.totalReceived)}>
                              {formatRial(c.totalReceived)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">پرتکرارترین خدمات</CardTitle>
                <Link href="/crm" className="text-xs text-primary underline underline-offset-4">همه</Link>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>خدمت</TableHead>
                        <TableHead className="text-left">دفعات</TableHead>
                        <TableHead className="text-left">درآمد</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {topServices.map((s) => (
                        <TableRow key={s.serviceName}>
                          <TableCell className="font-medium">{s.serviceName}</TableCell>
                          <TableCell className="text-left tabular-nums">{formatCount(s.receptionCount)}</TableCell>
                          <TableCell className="text-left tabular-nums" title={formatRialExact(s.revenue)}>
                            {formatRial(s.revenue)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </div>

          <p className="text-xs text-muted-foreground">
            مبالغ به ریال؛ برای عدد دقیق نشانگر را روی مقدار نگه دارید.
            {coverage?.newestReceptionDate
              ? ` داده تا ${toPersianNum(coverage.newestReceptionDate)}.`
              : ""}
          </p>
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
