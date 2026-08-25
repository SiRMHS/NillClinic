"use client"

import { Suspense, useCallback, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { apiFetch } from "@/lib/api-client"
import {
  formatCount, formatPercent, formatRial, formatRialExact, formatRecency, toPersianNum,
} from "@/lib/format"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { SortableHead, type SortDirection } from "@/components/ui/sortable-table"
import { Skeleton } from "@/components/ui/skeleton"
import { AlertTriangle, Crown, RefreshCw, Search, TrendingDown, Users } from "lucide-react"
import { PatientDetailDialog } from "@/components/patient-detail-dialog"
import {
  PATIENT_TIER_LABELS,
  PATIENT_TIER_ORDER,
  TierBadge,
  type PatientTier,
} from "@/components/tier-badge"
import { toast } from "sonner"

type Segment =
  | "CHAMPION" | "LOYAL" | "POTENTIAL" | "NEW" | "AT_RISK" | "DORMANT" | "LOST"

interface RankedPatient {
  patientId: string
  patientExternalCode: number
  fullName: string | null
  mobile: string | null
  visitCount: number
  totalReceived: number
  totalDiscount: number
  totalOutstanding: number
  averageTicket: number
  firstVisitDate: string | null
  lastVisitDate: string | null
  recencyDays: number | null
  recencyScore: number
  frequencyScore: number
  monetaryScore: number
  rfmScore: number
  segment: Segment
  segmentLabel: string
  tier: PatientTier
  tierLabel: string
}

interface Coverage {
  oldestReceptionDate: string | null
  newestReceptionDate: string | null
  receptionCount: number
  lineCount: number
  rankedPatients: number
  metricsComputedAt: string | null
  syncComplete: boolean
  syncStatus: string
  syncCursorDate: string | null
}

interface SegmentSummary {
  segment: Segment
  segmentLabel: string
  patientCount: number
  totalReceived: number
  revenueShare: number
  averageTicket: number
}

/** Tone per segment: which groups deserve attention, and of what kind. */
const SEGMENT_TONE: Record<Segment, string> = {
  CHAMPION: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  LOYAL: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  POTENTIAL: "bg-cyan-100 text-cyan-800 dark:bg-cyan-950 dark:text-cyan-300",
  NEW: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300",
  AT_RISK: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  DORMANT: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  LOST: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300",
}

/** Wording mirrors the absolute day bands used by the scoring SQL. */
const SEGMENT_HINT: Record<Segment, string> = {
  CHAMPION: "تا ۶ ماه اخیر آمده‌اند، پرمراجعه و پرخرج",
  LOYAL: "۶ تا ۱۲ ماه پیش، ولی سابقه مراجعه منظم دارند",
  POTENTIAL: "تا یک سال اخیر آمده‌اند و جای رشد دارند",
  NEW: "تا ۶ ماه اخیر، و تنها یک بار آمده‌اند",
  AT_RISK: "۱ تا ۲ سال نیامده‌اند ولی ارزشمند بوده‌اند — قابل بازگرداندن",
  DORMANT: "بیش از یک سال غیرفعال، ولی سابقه خرج قابل توجه دارند",
  LOST: "بیش از ۲ سال غیرفعال و کم‌ارزش",
}

type SortKey =
  | "rfm" | "revenue" | "visits" | "recency"
  | "discount" | "outstanding" | "avgTicket" | "name" | "code" | "tier"

const PAGE_SIZE = 50

function ScorePips({ label, score }: { label: string; score: number }) {
  return (
    <span className="inline-flex items-center gap-1" title={`${label}: ${toPersianNum(score)} از ۵`}>
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <span className="font-mono text-xs tabular-nums">{toPersianNum(score)}</span>
    </span>
  )
}

export default function PatientRankingPage() {
  // Wrapped in Suspense because useSearchParams opts the tree into CSR bailout.
  return (
    <Suspense fallback={null}>
      <PatientRankingContent />
    </Suspense>
  )
}

function PatientRankingContent() {
  const searchParams = useSearchParams()
  const [patients, setPatients] = useState<RankedPatient[]>([])
  const [segments, setSegments] = useState<SegmentSummary[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  // Deep links from the dashboard ("در خطر ریزش" etc.) arrive pre-filtered.
  const [segment, setSegment] = useState<Segment | null>(
    (searchParams.get("segment") as Segment | null) ?? null,
  )
  const [sort, setSort] = useState<{ key: SortKey; direction: SortDirection }>({
    key: "rfm",
    direction: "desc",
  })
  const [tier, setTier] = useState<PatientTier | null>(
    (searchParams.get("tier") as PatientTier | null) ?? null,
  )
  const [searchInput, setSearchInput] = useState("")
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(true)
  const [recomputing, setRecomputing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [coverage, setCoverage] = useState<Coverage | null>(null)
  const [selected, setSelected] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const qs = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(page * PAGE_SIZE),
      sort: sort.key,
      direction: sort.direction,
    })
    if (segment) qs.set("segment", segment)
    if (tier) qs.set("tier", tier)
    if (search) qs.set("search", search)

    try {
      const [list, segs, cov] = await Promise.all([
        apiFetch<{ total: number; patients: RankedPatient[] }>(
          `/api/financial/patients/ranking?${qs.toString()}`,
        ),
        apiFetch<SegmentSummary[]>("/api/financial/patients/segments"),
        apiFetch<Coverage>("/api/visitors/coverage"),
      ])
      setPatients(list.patients)
      setTotal(list.total)
      setSegments(segs)
      setCoverage(cov)
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطا در دریافت رتبه‌بندی بیماران")
    } finally {
      setLoading(false)
    }
  }, [page, segment, tier, sort.key, sort.direction, search])

  useEffect(() => {
    void load()
  }, [load])

  const recompute = async () => {
    setRecomputing(true)
    try {
      const r = await apiFetch<{ patients: number; durationMs: number }>(
        "/api/financial/patients/ranking/recompute",
        { method: "POST" },
      )
      toast.success(
        `رتبه‌بندی ${toPersianNum(r.patients.toLocaleString("en-US"))} بیمار در ${toPersianNum(
          (r.durationMs / 1000).toFixed(1),
        )} ثانیه به‌روزرسانی شد`,
      )
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "به‌روزرسانی رتبه‌بندی ناموفق بود")
    } finally {
      setRecomputing(false)
    }
  }

  /** Server-side sort: re-clicking the active column flips direction. */
  const onSort = (key: SortKey, defaultDirection: SortDirection = "desc") => {
    setSort((s) =>
      s.key === key
        ? { key, direction: s.direction === "asc" ? "desc" : "asc" }
        : { key, direction: defaultDirection },
    )
    setPage(0)
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6" dir="rtl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">رتبه‌بندی بیماران</h1>
          <p className="text-sm text-muted-foreground">
            بر پایه RFM — تازگی مراجعه، تعداد مراجعه و مجموع پرداخت
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void recompute()} disabled={recomputing}>
          <RefreshCw className={`size-4 ${recomputing ? "animate-spin" : ""}`} />
          محاسبه مجدد
        </Button>
      </div>

      {error ? (
        <Card>
          <CardContent className="py-6 text-center text-sm text-rose-600 dark:text-rose-400">
            {error}
          </CardContent>
        </Card>
      ) : null}

      {coverage && !coverage.syncComplete ? (
        <Card className="border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40">
          <CardContent className="flex items-start gap-3 py-3 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <div>
              <span className="font-medium">سینک پذیرش‌ها هنوز کامل نشده است.</span>{" "}
              امتیازهای RFM نسبی‌اند، پس تا پایان سینک «تازگی مراجعه» گمراه‌کننده است — بیمارانی که
              فقط بازه‌های سینک‌شده را دارند تازه به نظر می‌رسند.
              <div className="mt-1 text-xs text-muted-foreground">
                داده موجود:{" "}
                {coverage.oldestReceptionDate ? toPersianNum(coverage.oldestReceptionDate) : "—"} تا{" "}
                {coverage.newestReceptionDate ? toPersianNum(coverage.newestReceptionDate) : "—"}
                {" · "}
                {formatCount(coverage.receptionCount)} پذیرش
                {coverage.syncCursorDate
                  ? ` · سینک تا ${toPersianNum(coverage.syncCursorDate)} پیش رفته`
                  : ""}
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Segment cards double as the filter control. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        {segments.map((s) => {
          const active = segment === s.segment
          return (
            <button
              key={s.segment}
              type="button"
              onClick={() => {
                setSegment(active ? null : s.segment)
                setPage(0)
              }}
              className={`rounded-lg border p-3 text-right transition ${
                active ? "border-primary ring-2 ring-primary/30" : "hover:border-primary/50"
              }`}
              title={SEGMENT_HINT[s.segment]}
            >
              <div className="flex items-center justify-between gap-2">
                <Badge className={SEGMENT_TONE[s.segment]}>{s.segmentLabel}</Badge>
                {s.segment === "CHAMPION" ? <Crown className="size-3.5 text-emerald-600" /> : null}
                {s.segment === "AT_RISK" ? <TrendingDown className="size-3.5 text-amber-600" /> : null}
              </div>
              <div className="mt-2 text-xl font-bold tabular-nums">{formatCount(s.patientCount)}</div>
              <div className="text-xs text-muted-foreground">
                {formatRial(s.totalReceived)} · {formatPercent(s.revenueShare)} درآمد
              </div>
            </button>
          )
        })}
      </div>

      {/* Value tier stacks on top of the behavioural segment rather than
          replacing it: "platinum but at risk" is the combination worth acting on. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">رتبه ارزش:</span>
        <button
          type="button"
          onClick={() => { setTier(null); setPage(0) }}
          className={`rounded-md border px-2.5 py-1 text-xs transition ${
            tier === null ? "border-primary bg-primary/10 font-medium" : "hover:border-primary/50"
          }`}
        >
          همه
        </button>
        {PATIENT_TIER_ORDER.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => { setTier(tier === t ? null : t); setPage(0) }}
            className={`rounded-md border px-2.5 py-1 text-xs transition ${
              tier === t ? "border-primary bg-primary/10 font-medium" : "hover:border-primary/50"
            }`}
          >
            {PATIENT_TIER_LABELS[t]}
          </button>
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="size-4" />
            {segment
              ? `${segments.find((s) => s.segment === segment)?.segmentLabel ?? ""}`
              : "همه بیماران رتبه‌بندی‌شده"}
            <span className="text-sm font-normal text-muted-foreground">
              ({formatCount(total)} نفر)
            </span>
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <form
              className="relative"
              onSubmit={(e) => {
                e.preventDefault()
                setSearch(searchInput.trim())
                setPage(0)
              }}
            >
              <Search className="absolute right-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="نام، موبایل یا کد بیمار"
                className="w-56 pr-8"
              />
            </form>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : patients.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              بیماری با این شرایط یافت نشد.
              <br />
              اگر هنوز رتبه‌بندی محاسبه نشده، دکمه «محاسبه مجدد» را بزنید.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <SortableHead label="بیمار" sortKey="name" sort={sort} onSort={onSort} defaultDirection="asc" />
                  <SortableHead label="رتبه ارزش" sortKey="tier" sort={sort} onSort={onSort} />
                  <TableHead>سگمنت</TableHead>
                  <SortableHead label="RFM" sortKey="rfm" sort={sort} onSort={onSort} align="left" />
                  <SortableHead label="مراجعه" sortKey="visits" sort={sort} onSort={onSort} align="left" />
                  <SortableHead label="مجموع پرداخت" sortKey="revenue" sort={sort} onSort={onSort} align="left" />
                  <SortableHead label="میانگین" sortKey="avgTicket" sort={sort} onSort={onSort} align="left" />
                  <SortableHead label="مانده" sortKey="outstanding" sort={sort} onSort={onSort} align="left" />
                  <SortableHead label="آخرین مراجعه" sortKey="recency" sort={sort} onSort={onSort} align="left" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {patients.map((p, i) => (
                  <TableRow
                    key={p.patientId}
                    onClick={() => setSelected(p.patientExternalCode)}
                    className="cursor-pointer"
                    title="مشاهده پرونده بیمار"
                  >
                    <TableCell className="text-muted-foreground tabular-nums">
                      {toPersianNum(page * PAGE_SIZE + i + 1)}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{p.fullName ?? "—"}</div>
                      <div className="text-xs text-muted-foreground tabular-nums">
                        {p.mobile ? toPersianNum(p.mobile) : "—"} · کد {toPersianNum(p.patientExternalCode)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <TierBadge tier={p.tier} />
                    </TableCell>
                    <TableCell>
                      <Badge className={SEGMENT_TONE[p.segment]} title={SEGMENT_HINT[p.segment]}>
                        {p.segmentLabel}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-left">
                      {/* inline-flex so the cell's text-left places it, matching the header */}
                      <span className="inline-flex items-center gap-2 align-middle">
                        <ScorePips label="R" score={p.recencyScore} />
                        <ScorePips label="F" score={p.frequencyScore} />
                        <ScorePips label="M" score={p.monetaryScore} />
                      </span>
                    </TableCell>
                    <TableCell className="text-left tabular-nums">{toPersianNum(p.visitCount)}</TableCell>
                    <TableCell
                      className="text-left font-medium tabular-nums"
                      title={formatRialExact(p.totalReceived)}
                    >
                      {formatRial(p.totalReceived)}
                    </TableCell>
                    <TableCell className="text-left tabular-nums">{formatRial(p.averageTicket)}</TableCell>
                    <TableCell
                      className={`text-left tabular-nums ${
                        p.totalOutstanding > 0 ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground"
                      }`}
                    >
                      {p.totalOutstanding > 0 ? formatRial(p.totalOutstanding) : "—"}
                    </TableCell>
                    <TableCell className="text-left">
                      <div className="text-sm">{formatRecency(p.recencyDays)}</div>
                      <div className="text-xs text-muted-foreground tabular-nums">
                        {p.lastVisitDate ? toPersianNum(p.lastVisitDate) : "—"}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {totalPages > 1 ? (
        <div className="flex items-center justify-between">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            قبلی
          </Button>
          <span className="text-sm text-muted-foreground">
            صفحه {toPersianNum(page + 1)} از {toPersianNum(totalPages)}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page + 1 >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            بعدی
          </Button>
        </div>
      ) : null}

      <PatientDetailDialog
        externalCode={selected}
        open={selected !== null}
        onOpenChange={(o) => {
          if (!o) setSelected(null)
        }}
      />

      <p className="text-xs text-muted-foreground">
        امتیازهای R/F/M پنجک جمعیت بیماران‌اند: «۵» یعنی یک‌پنجم برتر همین کلینیک، نه یک آستانه ثابت.
        فقط بیمارانی رتبه می‌گیرند که حداقل یک پذیرش مالی ثبت‌شده دارند. چون امتیازها نسبی‌اند،
        پس از هر سینک به‌صورت خودکار بازمحاسبه می‌شوند.
      </p>
    </div>
  )
}
