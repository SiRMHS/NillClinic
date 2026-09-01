"use client"

import { Suspense, useCallback, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { apiFetch, apiDownload } from "@/lib/api-client"
import { formatCount, formatPercent, formatRial, formatRialExact, toPersianNum } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import { DateRangeFilter, type DateRange } from "@/components/ui/date-range-filter"
import { PatientDetailDialog } from "@/components/patient-detail-dialog"
import {
  PATIENT_TIER_LABELS,
  PATIENT_TIER_ORDER,
  TIER_RING,
  TierBadge,
  type PatientTier,
} from "@/components/tier-badge"
import {
  CalendarClock,
  CalendarCheck,
  Download,
  Search,
  Settings2,
  TrendingDown,
  Users,
} from "lucide-react"
import { toast } from "sonner"
import { TierSettingsDialog } from "./tier-settings-dialog"
import { useAuth } from "@/stores/auth.store"

interface TierSummary {
  tier: PatientTier
  tierLabel: string
  patientCount: number
  totalReceived: number
  totalOutstanding: number
  revenueShare: number
  averageSpend: number
  minSpend: number | null
  atRiskCount: number
}

interface ActivityItem {
  kind: "RECEPTION" | "RESERVE"
  id: string
  patientId: string | null
  patientExternalCode: number | null
  fullName: string | null
  mobile: string | null
  tier: PatientTier
  tierLabel: string
  segment: string | null
  lifetimeSpend: number
  visitCount: number
  date: string | null
  time: string | null
  doctorName: string | null
  services: string | null
  amount: number | null
  isAccepted: boolean | null
  isUpcoming: boolean
}

interface ActivityStats {
  tiers: PatientTier[]
  upcomingReserves: number
  receptions30d: number
  revenue30d: number
  lapsed: number
}

const PAGE_SIZE = 50

/** What each tier means, in the clinic's own terms. */
const TIER_HINT: Record<PatientTier, string> = {
  PLATINUM: "بالاترین سطح خرج — و بیمارانی که دستی VIP یا سلبریتی شده‌اند",
  GOLD: "خرج بالا و مستمر",
  SILVER: "خرج متوسط، جای رشد دارند",
  BRONZE: "خرج کم، بالاتر از آستانه برنز",
  GRAY: "کمتر از آستانه برنز یا بدون پرداخت",
}

export default function TiersPage() {
  // useSearchParams opts the tree into a CSR bailout, so it needs a boundary.
  return (
    <Suspense fallback={null}>
      <TiersContent />
    </Suspense>
  )
}

function TiersContent() {
  const searchParams = useSearchParams()

  const [summary, setSummary] = useState<TierSummary[]>([])
  const [stats, setStats] = useState<ActivityStats | null>(null)
  const [items, setItems] = useState<ActivityItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)

  // The page opens on the highest-value tiers, because the whole reason to
  // watch a feed of appointments is that these are the ones worth noticing.
  const [tiers, setTiers] = useState<PatientTier[]>(() => {
    const param = searchParams.get("tier")
    return param ? (param.split(",") as PatientTier[]) : ["PLATINUM", "GOLD"]
  })
  const [kind, setKind] = useState<"" | "RECEPTION" | "RESERVE">("")
  const [upcomingOnly, setUpcomingOnly] = useState(false)
  const [range, setRange] = useState<DateRange>({ from: "", to: "" })
  const [searchInput, setSearchInput] = useState("")
  const [search, setSearch] = useState("")
  const [doctor, setDoctor] = useState("")

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  // Downloading is its own key: a role may read the report on screen
  // without being allowed to carry the numbers out of the system.
  // Subscribes to `user` rather than to `hasPermission`: the function
  // identity never changes, so selecting it would not re-render once
  // /api/auth/me resolves and the button would stay hidden.
  const canExport = useAuth(
    (s) => s.user?.permissions.includes("*") || s.user?.permissions.includes("financial.export"),
  ) ?? false

  const query = useMemo(() => {
    const qs = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(page * PAGE_SIZE),
    })
    if (tiers.length) qs.set("tiers", tiers.join(","))
    if (kind) qs.set("kind", kind)
    if (upcomingOnly) qs.set("upcomingOnly", "true")
    if (range.from) qs.set("from", range.from)
    if (range.to) qs.set("to", range.to)
    if (search) qs.set("search", search)
    if (doctor) qs.set("doctor", doctor)
    return qs
  }, [page, tiers, kind, upcomingOnly, range.from, range.to, search, doctor])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const statsQs = tiers.length ? `?tiers=${tiers.join(",")}` : ""
      const [feed, sum, st] = await Promise.all([
        apiFetch<{ total: number; items: ActivityItem[] }>(`/api/reports/tiers/activity?${query}`),
        apiFetch<TierSummary[]>("/api/reports/tiers/summary"),
        apiFetch<ActivityStats>(`/api/reports/tiers/activity/stats${statsQs}`),
      ])
      setItems(feed.items)
      setTotal(feed.total)
      setSummary(sum)
      setStats(st)
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطا در دریافت اطلاعات رتبه‌بندی")
    } finally {
      setLoading(false)
    }
  }, [query, tiers])

  useEffect(() => {
    void load()
  }, [load])

  const toggleTier = (tier: PatientTier) => {
    setTiers((current) =>
      current.includes(tier) ? current.filter((t) => t !== tier) : [...current, tier],
    )
    setPage(0)
  }

  const exportCsv = async () => {
    setExporting(true)
    try {
      await apiDownload(`/api/reports/tiers/activity/export?${query}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "خروجی گرفتن ناموفق بود")
    } finally {
      setExporting(false)
    }
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)
  const selectedLabel = tiers.length
    ? tiers.map((t) => PATIENT_TIER_LABELS[t]).join(" و ")
    : "همه رتبه‌ها"

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6" dir="rtl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">رتبه‌بندی ارزش بیماران</h1>
          <p className="text-sm text-muted-foreground">
            بر پایه مجموع پرداختی هر بیمار — و اینکه همین بیماران چه زمانی نوبت یا پذیرش جدید
            می‌گیرند
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>
            <Settings2 className="size-4" />
            آستانه‌ها
          </Button>
          {canExport && (
        <Button variant="outline" size="sm" onClick={() => void exportCsv()} disabled={exporting}>
            <Download className="size-4" />
            خروجی اکسل
          </Button>
          )}
        </div>
      </div>

      {error ? (
        <Card>
          <CardContent className="py-6 text-center text-sm text-rose-600 dark:text-rose-400">
            {error}
          </CardContent>
        </Card>
      ) : null}

      {/* Tier cards are the filter. Clicking one toggles it in the feed below. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {(summary.length
          ? summary
          : (PATIENT_TIER_ORDER.map(() => null) as (TierSummary | null)[])
        ).map((s, index) => {
          if (!s) return <Skeleton key={index} className="h-32 rounded-lg" />
          const active = tiers.includes(s.tier)
          return (
            <button
              key={s.tier}
              type="button"
              onClick={() => toggleTier(s.tier)}
              title={TIER_HINT[s.tier]}
              className={`rounded-lg border p-3 text-right transition ${
                active ? `ring-2 ${TIER_RING[s.tier]}` : "hover:border-primary/50"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <TierBadge tier={s.tier} />
                <span className="text-xs text-muted-foreground">
                  {formatPercent(s.revenueShare)} درآمد
                </span>
              </div>
              <div className="mt-2 text-xl font-bold tabular-nums">
                {formatCount(s.patientCount)}
                <span className="mr-1 text-xs font-normal text-muted-foreground">بیمار</span>
              </div>
              <div className="mt-1 text-xs text-muted-foreground" title={formatRialExact(s.totalReceived)}>
                {formatRial(s.totalReceived)} ریال
                {s.minSpend !== null ? (
                  <span className="block">از {formatRial(s.minSpend)} ریال به بالا</span>
                ) : (
                  <span className="block">کمتر از آستانه برنز</span>
                )}
              </div>
              {s.atRiskCount > 0 ? (
                <div className="mt-1 flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                  <TrendingDown className="size-3" />
                  {formatCount(s.atRiskCount)} نفر بیش از یک سال نیامده‌اند
                </div>
              ) : null}
            </button>
          )
        })}
      </div>

      {/* Headline numbers, scoped to whichever tiers are selected. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<CalendarClock className="size-4" />}
          label={`نوبت‌های پیش‌رو (${selectedLabel})`}
          value={stats ? formatCount(stats.upcomingReserves) : null}
          onClick={() => {
            setUpcomingOnly(true)
            setKind("RESERVE")
            setPage(0)
          }}
        />
        <StatCard
          icon={<CalendarCheck className="size-4" />}
          label="پذیرش ۳۰ روز اخیر"
          value={stats ? formatCount(stats.receptions30d) : null}
        />
        <StatCard
          icon={<Users className="size-4" />}
          label="درآمد ۳۰ روز اخیر"
          value={stats ? `${formatRial(stats.revenue30d)} ریال` : null}
          title={stats ? formatRialExact(stats.revenue30d) : undefined}
        />
        <StatCard
          icon={<TrendingDown className="size-4" />}
          label="بیش از یک سال نیامده‌اند"
          value={stats ? formatCount(stats.lapsed) : null}
          tone="warning"
        />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-base">
              فعالیت بیماران
              <span className="mr-2 text-xs font-normal text-muted-foreground">
                {formatCount(total)} رویداد
              </span>
            </CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <ToggleChip active={kind === ""} onClick={() => { setKind(""); setPage(0) }}>
                همه
              </ToggleChip>
              <ToggleChip
                active={kind === "RESERVE"}
                onClick={() => { setKind("RESERVE"); setPage(0) }}
              >
                نوبت‌ها
              </ToggleChip>
              <ToggleChip
                active={kind === "RECEPTION"}
                onClick={() => { setKind("RECEPTION"); setUpcomingOnly(false); setPage(0) }}
              >
                پذیرش‌ها
              </ToggleChip>
              <ToggleChip
                active={upcomingOnly}
                onClick={() => { setUpcomingOnly((v) => !v); setPage(0) }}
              >
                فقط پیش‌رو
              </ToggleChip>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <DateRangeFilter
              value={range}
              onChange={(r) => { setRange(r); setPage(0) }}
            />
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                setSearch(searchInput.trim())
                setPage(0)
              }}
            >
              <div className="relative">
                <Search className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="نام، موبایل یا کد بیمار"
                  className="h-9 w-56 pr-8"
                />
              </div>
              <Input
                value={doctor}
                onChange={(e) => setDoctor(e.target.value)}
                onBlur={() => setPage(0)}
                placeholder="نام پزشک"
                className="h-9 w-40"
              />
              <Button type="submit" size="sm" variant="secondary">
                جستجو
              </Button>
            </form>
          </div>
        </CardHeader>

        <CardContent className="px-0">
          {loading ? (
            <div className="space-y-2 px-6">
              {Array.from({ length: 8 }, (_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              رویدادی با این فیلترها یافت نشد.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">نوع</TableHead>
                    <TableHead className="text-right">تاریخ</TableHead>
                    <TableHead className="text-right">بیمار</TableHead>
                    <TableHead className="text-right">رتبه</TableHead>
                    <TableHead className="text-right">مجموع خرید</TableHead>
                    <TableHead className="text-right">پزشک</TableHead>
                    <TableHead className="text-right">خدمات</TableHead>
                    <TableHead className="text-right">مبلغ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <TableRow
                      key={item.id}
                      className={`cursor-pointer ${item.isUpcoming ? "bg-emerald-50/60 dark:bg-emerald-950/20" : ""}`}
                      onClick={() =>
                        item.patientExternalCode !== null && setSelected(item.patientExternalCode)
                      }
                    >
                      <TableCell className="whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs ${
                            item.kind === "RESERVE"
                              ? "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {item.kind === "RESERVE" ? (
                            <CalendarClock className="size-3" />
                          ) : (
                            <CalendarCheck className="size-3" />
                          )}
                          {item.kind === "RESERVE" ? "نوبت" : "پذیرش"}
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm tabular-nums">
                        {item.date ? toPersianNum(item.date) : "—"}
                        {item.time ? (
                          <span className="mr-1 text-xs text-muted-foreground">
                            {toPersianNum(item.time)}
                          </span>
                        ) : null}
                        {item.isUpcoming ? (
                          <span className="mr-1 rounded bg-emerald-100 px-1 text-[10px] text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                            پیش‌رو
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="max-w-[180px]">
                        <div className="truncate text-sm font-medium">{item.fullName ?? "—"}</div>
                        <div className="text-xs text-muted-foreground tabular-nums">
                          {item.mobile ? toPersianNum(item.mobile) : ""}
                        </div>
                      </TableCell>
                      <TableCell>
                        <TierBadge tier={item.tier} />
                      </TableCell>
                      <TableCell
                        className="whitespace-nowrap text-sm tabular-nums"
                        title={formatRialExact(item.lifetimeSpend)}
                      >
                        {formatRial(item.lifetimeSpend)}
                        <span className="block text-xs text-muted-foreground">
                          {formatCount(item.visitCount)} مراجعه
                        </span>
                      </TableCell>
                      <TableCell className="max-w-[160px] truncate text-sm">
                        {item.doctorName ?? "—"}
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground">
                        {item.services ?? "—"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm tabular-nums">
                        {item.amount === null ? "—" : formatRial(item.amount)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {totalPages > 1 ? (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
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
        onOpenChange={(open) => {
          if (!open) setSelected(null)
        }}
      />

      <TierSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onSaved={() => void load()}
      />
    </div>
  )
}

function StatCard({
  icon,
  label,
  value,
  tone,
  title,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  value: string | null
  tone?: "warning"
  title?: string
  onClick?: () => void
}) {
  const Wrapper = onClick ? "button" : "div"
  return (
    <Wrapper
      {...(onClick ? { type: "button" as const, onClick } : {})}
      title={title}
      className={`rounded-lg border p-3 text-right ${onClick ? "transition hover:border-primary/50" : ""}`}
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      {value === null ? (
        <Skeleton className="mt-2 h-6 w-20" />
      ) : (
        <div
          className={`mt-1 text-xl font-bold tabular-nums ${
            tone === "warning" ? "text-amber-600 dark:text-amber-400" : ""
          }`}
        >
          {value}
        </div>
      )}
    </Wrapper>
  )
}

function ToggleChip({
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
