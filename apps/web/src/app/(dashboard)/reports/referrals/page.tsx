"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { apiDownload, apiFetch } from "@/lib/api-client"
import { formatCount, formatPercent, formatRial, formatRialExact, toPersianNum } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import { DateRangeFilter, type DateRange } from "@/components/ui/date-range-filter"
import { SortableHead, type SortDirection } from "@/components/ui/sortable-table"
import { PatientDetailDialog } from "@/components/patient-detail-dialog"
import {
  PATIENT_TIER_LABELS,
  PATIENT_TIER_ORDER,
  TierBadge,
  type PatientTier,
} from "@/components/tier-badge"
import { Download, GitBranch, Info, Search } from "lucide-react"
import { toast } from "sonner"
import { useAuth } from "@/stores/auth.store"

interface ReferralPatient {
  patientId: string | null
  patientExternalCode: number
  fullName: string | null
  mobile: string | null
  tier: PatientTier | null
  tierLabel: string | null
  consultationDate: string | null
  consultationCount: number
  treatingDoctors: string[]
  treatmentServices: string[]
  treatmentCount: number
  treatmentReceived: number
  consultingDoctorReceived: number
  firstTreatmentDate: string | null
  lastTreatmentDate: string | null
  lifetimeSpend: number
}

interface ReferralReport {
  patients: ReferralPatient[]
  total: number
  summary: {
    consultingDoctor: string
    totalConsulted: number
    referredOut: number
    retained: number
    referralRate: number
    treatmentRevenue: number
    averagePerReferral: number
  }
  byTreatingDoctor: Array<{
    doctorName: string
    patientCount: number
    treatmentCount: number
    received: number
  }>
  generatedAt: string
}

interface DoctorOption {
  name: string
  patientCount: number
  received: number
}

type SortKey =
  | "treatmentReceived" | "lifetimeSpend" | "treatmentCount"
  | "consultationDate" | "firstTreatmentDate" | "name"

const PAGE_SIZE = 50
const DEFAULT_CONSULTANT = "محمد علی نیلفروش زاده"

export default function ReferralsPage() {
  const [report, setReport] = useState<ReferralReport | null>(null)
  const [options, setOptions] = useState<DoctorOption[]>([])
  const [consultant, setConsultant] = useState(DEFAULT_CONSULTANT)
  const [treatingDoctors, setTreatingDoctors] = useState<string[]>([])
  const [range, setRange] = useState<DateRange>({ from: "", to: "" })
  const [tier, setTier] = useState<PatientTier | "">("")
  const [searchInput, setSearchInput] = useState("")
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(0)
  const [sort, setSort] = useState<{ key: SortKey; direction: SortDirection }>({
    key: "treatmentReceived",
    direction: "desc",
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
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
    const qs = new URLSearchParams({
      consultingDoctor: consultant,
      limit: String(PAGE_SIZE),
      offset: String(page * PAGE_SIZE),
      sort: sort.key,
      direction: sort.direction,
    })
    if (range.from) qs.set("from", range.from)
    if (range.to) qs.set("to", range.to)
    if (tier) qs.set("tier", tier)
    if (search) qs.set("search", search)
    if (treatingDoctors.length) qs.set("treatingDoctors", treatingDoctors.join(","))
    return qs
  }, [consultant, page, sort.key, sort.direction, range.from, range.to, tier, search, treatingDoctors])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [rep, docs] = await Promise.all([
        apiFetch<ReferralReport>(`/api/reports/referrals?${query}`),
        apiFetch<DoctorOption[]>("/api/reports/doctors"),
      ])
      setReport(rep)
      setOptions(docs)
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطا در دریافت گزارش ارجاع")
    } finally {
      setLoading(false)
    }
  }, [query])

  useEffect(() => {
    void load()
  }, [load])

  const onSort = (key: SortKey, defaultDirection: SortDirection = "desc") => {
    setSort((s) =>
      s.key === key
        ? { key, direction: s.direction === "asc" ? "desc" : "asc" }
        : { key, direction: defaultDirection },
    )
    setPage(0)
  }

  const exportCsv = async () => {
    setExporting(true)
    try {
      await apiDownload(`/api/reports/referrals/export?${query}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "خروجی گرفتن ناموفق بود")
    } finally {
      setExporting(false)
    }
  }

  const totalPages = report ? Math.ceil(report.total / PAGE_SIZE) : 0

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6" dir="rtl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">ارجاع پس از مشاوره</h1>
          <p className="text-sm text-muted-foreground">
            بیمارانی که مشاوره‌شان با یک پزشک بوده ولی درمان یا خدمت را پزشک دیگری انجام داده است
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
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">پزشک مشاور:</span>
            {options.slice(0, 8).map((d) => (
              <Chip
                key={d.name}
                active={consultant === d.name}
                onClick={() => {
                  setConsultant(d.name)
                  setPage(0)
                }}
              >
                {d.name}
              </Chip>
            ))}
          </div>

          <div>
            <span className="text-xs text-muted-foreground">
              بازه تاریخی (بر اساس تاریخ مشاوره):
            </span>
            <div className="mt-1">
              <DateRangeFilter
                value={range}
                onChange={(r) => {
                  setRange(r)
                  setPage(0)
                }}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">رتبه بیمار:</span>
            <Chip active={tier === ""} onClick={() => { setTier(""); setPage(0) }}>
              همه
            </Chip>
            {PATIENT_TIER_ORDER.map((t) => (
              <Chip
                key={t}
                active={tier === t}
                onClick={() => { setTier(tier === t ? "" : t); setPage(0) }}
              >
                {PATIENT_TIER_LABELS[t]}
              </Chip>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">پزشک درمان‌کننده:</span>
            <Chip active={treatingDoctors.length === 0} onClick={() => { setTreatingDoctors([]); setPage(0) }}>
              همه
            </Chip>
            {(report?.byTreatingDoctor ?? []).slice(0, 10).map((d) => (
              <Chip
                key={d.doctorName}
                active={treatingDoctors.includes(d.doctorName)}
                onClick={() => {
                  setTreatingDoctors((c) =>
                    c.includes(d.doctorName)
                      ? c.filter((x) => x !== d.doctorName)
                      : [...c, d.doctorName],
                  )
                  setPage(0)
                }}
              >
                {d.doctorName}
              </Chip>
            ))}
          </div>

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
            <Button type="submit" size="sm" variant="secondary">
              جستجو
            </Button>
          </form>
        </CardContent>
      </Card>

      {report ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Stat label="کل مشاوره‌شده‌ها" value={formatCount(report.summary.totalConsulted)} />
            <Stat
              label="ارجاع به پزشک دیگر"
              value={formatCount(report.summary.referredOut)}
              icon={<GitBranch className="size-4" />}
              accent
            />
            <Stat label="نرخ ارجاع" value={formatPercent(report.summary.referralRate)} />
            <Stat
              label="درآمد درمان‌های ارجاعی"
              value={`${formatRial(report.summary.treatmentRevenue)} ریال`}
              title={formatRialExact(report.summary.treatmentRevenue)}
            />
            <Stat
              label="میانگین هر ارجاع"
              value={`${formatRial(report.summary.averagePerReferral)} ریال`}
              title={formatRialExact(report.summary.averagePerReferral)}
            />
          </div>

          <Card className="border-sky-300 bg-sky-50 dark:border-sky-900 dark:bg-sky-950/30">
            <CardContent className="flex items-start gap-2 py-3 text-xs">
              <Info className="mt-0.5 size-4 shrink-0 text-sky-600 dark:text-sky-400" />
              <span>
                «ارجاع» یعنی بیمار حداقل یک مشاوره با {report.summary.consultingDoctor} داشته و
                سپس — از همان روز به بعد — خدمتی غیر از مشاوره را پزشک دیگری برایش انجام داده است.
                {" "}
                {formatCount(report.summary.retained)} بیمار را خودِ ایشان هم درمان کرده‌اند؛ این دو
                گروه می‌توانند هم‌پوشانی داشته باشند.
              </span>
            </CardContent>
          </Card>

          {report.byTreatingDoctor.length > 0 ? (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">درمان ارجاعی نزد کدام پزشک انجام شده</CardTitle>
              </CardHeader>
              <CardContent className="px-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-right">پزشک</TableHead>
                        <TableHead className="text-right">بیمار</TableHead>
                        <TableHead className="text-right">درمان</TableHead>
                        <TableHead className="text-right">درآمد</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {report.byTreatingDoctor.slice(0, 10).map((d) => (
                        <TableRow key={d.doctorName}>
                          <TableCell className="font-medium">{d.doctorName}</TableCell>
                          <TableCell className="tabular-nums">
                            {formatCount(d.patientCount)}
                          </TableCell>
                          <TableCell className="tabular-nums">
                            {formatCount(d.treatmentCount)}
                          </TableCell>
                          <TableCell className="tabular-nums" title={formatRialExact(d.received)}>
                            {formatRial(d.received)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          ) : null}
        </>
      ) : null}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            بیماران ارجاع‌شده
            {report ? (
              <span className="mr-2 text-xs font-normal text-muted-foreground">
                {formatCount(report.total)} بیمار
              </span>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          {loading ? (
            <div className="space-y-2 px-6">
              {Array.from({ length: 8 }, (_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : !report || report.patients.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              بیماری با این فیلترها یافت نشد.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableHead label="بیمار" sortKey="name" sort={sort} onSort={onSort} defaultDirection="asc" />
                    <TableHead className="text-right">رتبه</TableHead>
                    <SortableHead label="تاریخ مشاوره" sortKey="consultationDate" sort={sort} onSort={onSort} />
                    <TableHead className="text-right">پزشک درمان</TableHead>
                    <TableHead className="text-right">خدمت گرفته‌شده</TableHead>
                    <SortableHead label="تعداد درمان" sortKey="treatmentCount" sort={sort} onSort={onSort} />
                    <SortableHead label="درآمد درمان" sortKey="treatmentReceived" sort={sort} onSort={onSort} />
                    <SortableHead label="مجموع خرید" sortKey="lifetimeSpend" sort={sort} onSort={onSort} />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.patients.map((p) => (
                    <TableRow
                      key={p.patientExternalCode}
                      className="cursor-pointer"
                      onClick={() => setSelected(p.patientExternalCode)}
                    >
                      <TableCell className="max-w-[180px]">
                        <div className="truncate text-sm font-medium">{p.fullName ?? "—"}</div>
                        <div className="text-xs text-muted-foreground tabular-nums">
                          {p.mobile ? toPersianNum(p.mobile) : ""}
                        </div>
                      </TableCell>
                      <TableCell>{p.tier ? <TierBadge tier={p.tier} /> : "—"}</TableCell>
                      <TableCell className="whitespace-nowrap text-sm tabular-nums">
                        {p.consultationDate ? toPersianNum(p.consultationDate) : "—"}
                        {p.consultationCount > 1 ? (
                          <span className="mr-1 text-xs text-muted-foreground">
                            ({toPersianNum(p.consultationCount)} بار)
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="max-w-[200px]">
                        <div className="flex flex-wrap gap-1">
                          {p.treatingDoctors.slice(0, 3).map((d) => (
                            <span
                              key={d}
                              className="rounded bg-muted px-1.5 py-0.5 text-xs whitespace-nowrap"
                            >
                              {d}
                            </span>
                          ))}
                          {p.treatingDoctors.length > 3 ? (
                            <span className="text-xs text-muted-foreground">
                              +{toPersianNum(p.treatingDoctors.length - 3)}
                            </span>
                          ) : null}
                        </div>
                      </TableCell>
                      {/*
                        Which procedures the handover actually consisted of. The
                        doctor column alone says a patient went elsewhere and
                        paid; this says whether they got the treatment the
                        consultation was about. Two shown, the rest on hover —
                        the full list is in the CSV export.
                      */}
                      <TableCell className="max-w-[220px]">
                        {p.treatmentServices.length === 0 ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {p.treatmentServices.slice(0, 2).map((svc) => (
                              <span
                                key={svc}
                                className="max-w-[140px] truncate rounded bg-muted px-1.5 py-0.5 text-xs"
                                title={svc}
                              >
                                {svc}
                              </span>
                            ))}
                            {p.treatmentServices.length > 2 ? (
                              <span
                                className="text-xs text-muted-foreground"
                                title={p.treatmentServices.slice(2).join("، ")}
                              >
                                +{toPersianNum(p.treatmentServices.length - 2)}
                              </span>
                            ) : null}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {formatCount(p.treatmentCount)}
                      </TableCell>
                      <TableCell
                        className="whitespace-nowrap tabular-nums"
                        title={formatRialExact(p.treatmentReceived)}
                      >
                        {formatRial(p.treatmentReceived)}
                      </TableCell>
                      <TableCell
                        className="whitespace-nowrap tabular-nums text-muted-foreground"
                        title={formatRialExact(p.lifetimeSpend)}
                      >
                        {formatRial(p.lifetimeSpend)}
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
  accent,
}: {
  label: string
  value: string
  icon?: React.ReactNode
  title?: string
  accent?: boolean
}) {
  return (
    <div className={`rounded-lg border p-3 ${accent ? "border-primary/40 bg-primary/5" : ""}`} title={title}>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-xl font-bold tabular-nums">{value}</div>
    </div>
  )
}
