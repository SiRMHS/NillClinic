"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { apiDownload, apiFetch } from "@/lib/api-client"
import { MASKED_FIGURE, formatCount, formatRial, toPersianNum } from "@/lib/format"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Skeleton } from "@/components/ui/skeleton"
import { DateRangeFilter, type DateRange } from "@/components/ui/date-range-filter"
import { ContactDialog } from "@/components/crm-desk/contact-dialog"
import { ImportDialog, type ImportKind } from "@/components/crm-desk/import-dialog"
import { useCrmMasking } from "@/stores/display.store"
import type { ServiceSection } from "@/components/crm-desk/service-picker"
import {
  NPS_TONE, RISK_TONE, ratingTone,
  type ContactsResponse, type CrmContact, type CrmKpi, type CrmReferralReport,
  type DoctorScore, type ScheduleEntry,
} from "@/components/crm-desk/types"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import {
  CRM_CALL_RESULT_LABELS, CRM_CHANNEL_LABELS, CRM_CONTACT_KIND_LABELS,
  CRM_RATING_LABELS, CRM_RISK_LABELS, CRM_WEEKDAYS,
  NPS_BUCKET_LABELS,
  type CrmContactKind,
} from "@jordan/shared"
import {
  AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, Download, Gauge,
  HeartHandshake, PhoneCall, Plus, RefreshCw, Repeat, Search, Stethoscope,
  Trash2, TrendingUp, Upload, Users,
} from "lucide-react"

type Segment =
  | "all" | "risky" | "unanswered" | "rebook" | "promoters" | "detractors"
  | "referred" | "referred-pending"

const SEGMENT_LABELS: Record<Segment, string> = {
  all: "همه",
  risky: "پرریسک",
  unanswered: "بی‌پاسخ",
  rebook: "درخواست وقت مجدد",
  promoters: "مروج‌ها",
  detractors: "منتقدها",
  referred: "ارجاع‌شده",
  "referred-pending": "ارجاع بدون درمان",
}

const PAGE_SIZE = 25

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

/** A 1–5 dimension average drawn as a bar, so the weak dimension is visible at a glance. */
function ScoreBar({ label, value, responses }: { label: string; value: number | null; responses: number }) {
  const pct = value === null ? 0 : (value / 5) * 100
  return (
    <div className="grid gap-1">
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className={cn("font-semibold tabular-nums", ratingTone(pct))}>
          {value === null ? "—" : toPersianNum(value.toFixed(2))}
          <span className="ms-1 text-xs font-normal text-muted-foreground">
            ({toPersianNum(responses)})
          </span>
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            pct >= 80 ? "bg-emerald-500" : pct >= 60 ? "bg-amber-500" : "bg-rose-500",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

/**
 * A ranked "name (count)" list inside a table cell.
 *
 * The referral report answers three "who / what" questions per row, each of
 * which is a short ranked list rather than a single value — a doctor takes
 * referrals from several colleagues and delivers several services. Shown as
 * chips with the count attached, trimmed to the leading few so one busy doctor
 * does not stretch the row past the page.
 */
function NameCounts({ items, limit = 3 }: { items: { name: string; count: number }[]; limit?: number }) {
  if (items.length === 0) return <span className="text-xs text-muted-foreground">—</span>
  const shown = items.slice(0, limit)
  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((item) => (
        <Badge key={item.name} variant="secondary" className="gap-1 text-xs font-normal whitespace-nowrap">
          {item.name}
          <span className="tabular-nums opacity-70">{toPersianNum(item.count)}</span>
        </Badge>
      ))}
      {items.length > shown.length ? (
        // Titled rather than expandable: the remainder is a long tail of
        // one-offs, and the full list is in the CSV export.
        <span
          className="text-xs text-muted-foreground"
          title={items.slice(limit).map((i) => `${i.name} (${i.count})`).join("، ")}
        >
          +{toPersianNum(items.length - shown.length)}
        </span>
      ) : null}
    </div>
  )
}

function dash(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—"
  return typeof value === "number" ? toPersianNum(value) : value
}

export default function CrmDeskPage() {
  const [tab, setTab] = useState("kpi")
  const [range, setRange] = useState<DateRange>({ from: "", to: "" })

  const [kpi, setKpi] = useState<CrmKpi | null>(null)
  const [scores, setScores] = useState<DoctorScore[]>([])
  const [referrals, setReferrals] = useState<CrmReferralReport | null>(null)
  const [doctors, setDoctors] = useState<string[]>([])
  const [serviceCatalogue, setServiceCatalogue] = useState<ServiceSection[]>([])
  const [schedule, setSchedule] = useState<ScheduleEntry[]>([])
  const [loadingAgg, setLoadingAgg] = useState(true)

  const [contacts, setContacts] = useState<CrmContact[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loadingList, setLoadingList] = useState(true)
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [kindFilter, setKindFilter] = useState<CrmContactKind | "all">("all")
  const [segment, setSegment] = useState<Segment>("all")
  const [doctorFilter, setDoctorFilter] = useState("all")

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<CrmContact | null>(null)
  const [defaultKind, setDefaultKind] = useState<CrmContactKind>("FOLLOW_UP")
  const [importKind, setImportKind] = useState<ImportKind | null>(null)

  // The API has already stripped whatever these hide; the page still needs to
  // know, so a masked column is dropped rather than rendered as an empty cell.
  const masked = useCrmMasking()

  // Typing in the search box should not fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setPage(1) }, 350)
    return () => clearTimeout(t)
  }, [search])

  /** The tab decides which `kind` the list is pinned to; the survey tab is its own sheet. */
  const effectiveKind: CrmContactKind | "all" = tab === "survey" ? "SURVEY" : kindFilter

  const listParams = useCallback(() => {
    const p = new URLSearchParams()
    if (effectiveKind !== "all") p.set("kind", effectiveKind)
    if (range.from) p.set("from", range.from)
    if (range.to) p.set("to", range.to)
    if (debouncedSearch) p.set("search", debouncedSearch)
    if (segment !== "all") p.set("segment", segment)
    if (doctorFilter !== "all") p.set("doctorName", doctorFilter)
    return p
  }, [effectiveKind, range, debouncedSearch, segment, doctorFilter])

  const aggParams = useCallback(() => {
    const p = new URLSearchParams()
    if (range.from) p.set("from", range.from)
    if (range.to) p.set("to", range.to)
    return p
  }, [range])

  const loadAggregates = useCallback(async () => {
    setLoadingAgg(true)
    try {
      const q = aggParams().toString()
      const [k, s, ref, sch, meta] = await Promise.all([
        apiFetch<CrmKpi>(`/api/crm-desk/kpi?${q}`),
        apiFetch<DoctorScore[]>(`/api/crm-desk/doctor-scores?${q}`),
        apiFetch<CrmReferralReport>(`/api/crm-desk/referrals?${q}`),
        apiFetch<ScheduleEntry[]>("/api/crm-desk/schedule"),
        apiFetch<{ doctors: string[]; serviceCatalogue: ServiceSection[] }>("/api/crm-desk/meta"),
      ])
      setKpi(k)
      setScores(s)
      setReferrals(ref)
      setSchedule(sch)
      setDoctors(meta.doctors)
      setServiceCatalogue(meta.serviceCatalogue)
    } catch {
      toast.error("خطا در بارگذاری شاخص‌ها")
    } finally {
      setLoadingAgg(false)
    }
  }, [aggParams])

  const loadContacts = useCallback(async () => {
    setLoadingList(true)
    try {
      const p = listParams()
      p.set("page", String(page))
      p.set("pageSize", String(PAGE_SIZE))
      const res = await apiFetch<ContactsResponse>(`/api/crm-desk/contacts?${p}`)
      setContacts(res.data)
      setTotal(res.pagination.total)
    } catch {
      toast.error("خطا در بارگذاری تماس‌ها")
    } finally {
      setLoadingList(false)
    }
  }, [listParams, page])

  useEffect(() => { loadAggregates() }, [loadAggregates])
  useEffect(() => { loadContacts() }, [loadContacts])

  /**
   * Every filter resets to the first page.
   *
   * Done in the handlers rather than an effect on the filter values: an effect
   * runs *after* the list has already refetched at the old page number, so each
   * filter change cost two requests and briefly showed an empty page.
   */
  const applyFilter = <T,>(set: (value: T) => void) => (value: T) => { set(value); setPage(1) }

  const saveContact = async (payload: Record<string, unknown>, id: string | null) => {
    try {
      await apiFetch(`/api/crm-desk/contacts${id ? `/${id}` : ""}`, {
        method: id ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      })
      toast.success(id ? "تماس بروزرسانی شد" : "تماس ثبت شد")
      await Promise.all([loadContacts(), loadAggregates()])
    } catch {
      toast.error("خطا در ذخیره تماس")
      throw new Error("save failed")
    }
  }

  const deleteContact = async (row: CrmContact) => {
    if (!confirm(`حذف تماس «${row.patientName ?? "بدون نام"}» در تاریخ ${row.contactDate}؟`)) return
    try {
      await apiFetch(`/api/crm-desk/contacts/${row.id}`, { method: "DELETE" })
      toast.success("تماس حذف شد")
      await Promise.all([loadContacts(), loadAggregates()])
    } catch {
      toast.error("خطا در حذف تماس")
    }
  }

  const exportContacts = async () => {
    try {
      await apiDownload(`/api/crm-desk/contacts/export?${listParams()}`, "گزارش-CRM.csv")
      toast.success("خروجی آماده شد")
    } catch {
      toast.error("خطا در دریافت خروجی")
    }
  }

  const exportSchedule = async () => {
    try {
      await apiDownload("/api/crm-desk/schedule/export", "برنامه-هفتگی-پزشکان.csv")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "خطا در دریافت خروجی")
    }
  }

  const exportScores = async () => {
    try {
      await apiDownload(`/api/crm-desk/doctor-scores/export?${aggParams()}`, "امتیازدهی-پزشکان-CRM.csv")
      toast.success("خروجی آماده شد")
    } catch {
      toast.error("خطا در دریافت خروجی")
    }
  }

  const exportReferrals = async () => {
    try {
      await apiDownload(`/api/crm-desk/referrals/export?${aggParams()}`, "گزارش-ارجاع-CRM.csv")
      toast.success("خروجی آماده شد")
    } catch {
      toast.error("خطا در دریافت خروجی")
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const openNew = (kind: CrmContactKind) => {
    setEditing(null)
    setDefaultKind(kind)
    setDialogOpen(true)
  }

  const scheduleGrid = useMemo(() => {
    const names = [...new Set([...schedule.map((s) => s.doctorName), ...doctors])]
    const map = new Map<string, string>()
    for (const s of schedule) map.set(`${s.doctorName}|${s.weekday}`, s.note ?? "")
    return { names, map }
  }, [schedule, doctors])

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <HeartHandshake className="size-6 text-primary" />
            CRM
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            تماس‌های فالوآپ، نظرسنجی رضایت، امتیازدهی پزشکان و شاخص‌های وفاداری — جایگزین فایل اکسل CRM.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => { loadAggregates(); loadContacts() }}>
            <RefreshCw className="size-4" /> بروزرسانی
          </Button>
          <Button size="sm" onClick={() => openNew("FOLLOW_UP")}>
            <Plus className="size-4" /> ثبت تماس
          </Button>
        </div>
      </div>

      <DateRangeFilter value={range} onChange={applyFilter(setRange)} />

      <Tabs value={tab} onValueChange={applyFilter(setTab)}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="kpi">نمودار و KPI</TabsTrigger>
          <TabsTrigger value="contacts">تماس‌های فالوآپ</TabsTrigger>
          <TabsTrigger value="survey">نظرسنجی</TabsTrigger>
          <TabsTrigger value="doctors">امتیازدهی پزشکان</TabsTrigger>
          <TabsTrigger value="referrals">ارجاع و درمان</TabsTrigger>
          <TabsTrigger value="schedule">روزهای پزشکان</TabsTrigger>
        </TabsList>

        {/* ── نمودار و KPI ── */}
        <TabsContent value="kpi" className="mt-4 flex flex-col gap-4">
          {loadingAgg || !kpi ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
            </div>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Stat
                  label="تعداد تماس‌ها" value={formatCount(kpi.totalContacts)}
                  hint={`${toPersianNum(kpi.ratedContacts)} تماس امتیازدار`}
                  icon={<PhoneCall className="size-4" />}
                />
                <Stat
                  label="رضایت کلی"
                  value={kpi.satisfaction === null ? "—" : `${toPersianNum(kpi.satisfaction)}٪`}
                  hint="میانگین پنج بُعد رضایت"
                  icon={<Gauge className="size-4" />}
                  tone={kpi.satisfaction === null ? undefined : kpi.satisfaction >= 80 ? "positive" : kpi.satisfaction >= 60 ? "warning" : "danger"}
                />
                <Stat
                  label="شاخص NPS"
                  value={kpi.nps === null ? "—" : toPersianNum(kpi.nps)}
                  hint="درصد مروج‌ها منهای منتقدها"
                  icon={<TrendingUp className="size-4" />}
                  tone={kpi.nps === null ? undefined : kpi.nps >= 50 ? "positive" : kpi.nps >= 0 ? "warning" : "danger"}
                />
                <Stat
                  label="نرخ رزرو مجدد"
                  value={masked.rates ? MASKED_FIGURE : kpi.rebookRate === null ? "—" : `${toPersianNum(kpi.rebookRate)}٪`}
                  hint={`${toPersianNum(kpi.rebookCount)} درخواست وقت مجدد`}
                  icon={<Repeat className="size-4" />}
                />
                <Stat
                  label="نرخ پاسخگویی"
                  value={masked.rates ? MASKED_FIGURE : kpi.answerRate === null ? "—" : `${toPersianNum(kpi.answerRate)}٪`}
                  hint={`${toPersianNum(kpi.answeredContacts)} تماس پاسخ داده شده`}
                  icon={<Users className="size-4" />}
                />
                <Stat
                  label="بیماران پرریسک"
                  value={formatCount(kpi.atRiskCount)}
                  hint="ریسک ریزش بالای ۶۰٪"
                  icon={<AlertTriangle className="size-4" />}
                  tone={kpi.atRiskCount > 0 ? "danger" : "positive"}
                />
                {/* Dropped rather than shown masked: a KPI tile reading «———»
                    is a hole in a grid of numbers, and the count beside it
                    already says how much of the period it covers. */}
                {!masked.amounts && (
                  <Stat
                    label="درآمد ثبت‌شده"
                    value={formatRial(kpi.revenue ?? 0, { withUnit: true })}
                    hint="جمع مبالغ عددی ثبت‌شده در تماس‌ها"
                    icon={<Stethoscope className="size-4" />}
                  />
                )}
                <Stat
                  label="بازه گزارش"
                  value={range.from || range.to ? `${dash(range.from)} تا ${dash(range.to)}` : "همه"}
                  hint="با فیلتر بالای صفحه تغییر می‌کند"
                  icon={<CalendarDays className="size-4" />}
                />
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader><CardTitle className="text-base">میانگین رضایت به تفکیک بُعد</CardTitle></CardHeader>
                  <CardContent className="grid gap-4">
                    {kpi.dimensionAverages.map((d) => (
                      <ScoreBar key={d.key} label={d.label} value={d.average} responses={d.responses} />
                    ))}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader><CardTitle className="text-base">نحوه آشنایی مراجعین</CardTitle></CardHeader>
                  <CardContent>
                    {kpi.channels.length === 0 ? (
                      <p className="text-sm text-muted-foreground">داده‌ای ثبت نشده است.</p>
                    ) : (
                      <div className="grid gap-3">
                        {kpi.channels.map((c) => {
                          const max = kpi.channels[0]?.count || 1
                          return (
                            <div key={c.channel} className="grid gap-1">
                              <div className="flex items-baseline justify-between text-sm">
                                <span className="text-muted-foreground">{CRM_CHANNEL_LABELS[c.channel]}</span>
                                <span className="font-semibold tabular-nums">{toPersianNum(c.count)}</span>
                              </div>
                              <div className="h-2 overflow-hidden rounded-full bg-muted">
                                <div className="h-full rounded-full bg-primary" style={{ width: `${(c.count / max) * 100}%` }} />
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader><CardTitle className="text-base">روند ماهانه</CardTitle></CardHeader>
                <CardContent>
                  {kpi.trend.length === 0 ? (
                    <p className="text-sm text-muted-foreground">داده‌ای برای این بازه نیست.</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>ماه</TableHead>
                          <TableHead>تعداد تماس</TableHead>
                          <TableHead>رضایت کلی</TableHead>
                          <TableHead>NPS</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {kpi.trend.map((t) => (
                          <TableRow key={t.period}>
                            <TableCell className="font-medium">{toPersianNum(t.period)}</TableCell>
                            <TableCell className="tabular-nums">{toPersianNum(t.contacts)}</TableCell>
                            <TableCell className={cn("tabular-nums", ratingTone(t.satisfaction))}>
                              {t.satisfaction === null ? "—" : `${toPersianNum(t.satisfaction)}٪`}
                            </TableCell>
                            <TableCell className="tabular-nums">{t.nps === null ? "—" : toPersianNum(t.nps)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* ── تماس‌ها / نظرسنجی share one table ── */}
        {(["contacts", "survey"] as const).map((which) => (
          <TabsContent key={which} value={which} className="mt-4 flex flex-col gap-4">
            <Card>
              <CardContent className="flex flex-wrap items-end gap-3 pt-6">
                <div className="grid min-w-52 flex-1 gap-1.5">
                  <Label htmlFor={`search-${which}`} className="text-xs text-muted-foreground">جستجو</Label>
                  <div className="relative">
                    <Search className="absolute start-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id={`search-${which}`}
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="نام بیمار، شماره پرونده، پزشک، خدمت…"
                      className="ps-8"
                    />
                  </div>
                </div>

                {which === "contacts" && (
                  <div className="grid gap-1.5">
                    <Label className="text-xs text-muted-foreground">نوع</Label>
                    <Select value={kindFilter} onValueChange={applyFilter((v: string | null) => setKindFilter((v ?? "all") as CrmContactKind | "all"))}>
                      <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">همه انواع</SelectItem>
                        {Object.entries(CRM_CONTACT_KIND_LABELS).map(([k, v]) => (
                          <SelectItem key={k} value={k}>{v}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="grid gap-1.5">
                  <Label className="text-xs text-muted-foreground">وضعیت</Label>
                  <Select value={segment} onValueChange={applyFilter((v: string | null) => setSegment((v ?? "all") as Segment))}>
                    <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(SEGMENT_LABELS).map(([k, v]) => (
                        <SelectItem key={k} value={k}>{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-1.5">
                  <Label className="text-xs text-muted-foreground">پزشک</Label>
                  <Select value={doctorFilter} onValueChange={applyFilter((v: string | null) => setDoctorFilter(v ?? "all"))}>
                    <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">همه پزشکان</SelectItem>
                      {doctors.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex gap-2">
                  <Button variant="outline" onClick={exportContacts}>
                    <Download className="size-4" /> خروجی اکسل
                  </Button>
                  <Button variant="outline" onClick={() => setImportKind("contacts")}>
                    <Upload className="size-4" /> ورود از فایل
                  </Button>
                  <Button onClick={() => openNew(which === "survey" ? "SURVEY" : "FOLLOW_UP")}>
                    <Plus className="size-4" /> ثبت
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                {loadingList ? (
                  <div className="grid gap-2">
                    {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10" />)}
                  </div>
                ) : contacts.length === 0 ? (
                  <p className="py-10 text-center text-sm text-muted-foreground">
                    تماسی با این فیلترها ثبت نشده است.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>پرونده</TableHead>
                          <TableHead>نام بیمار</TableHead>
                          <TableHead>پزشک</TableHead>
                          <TableHead>تاریخ مراجعه</TableHead>
                          <TableHead>تاریخ تماس</TableHead>
                          <TableHead>خدمات</TableHead>
                          <TableHead>ارجاع / درمان</TableHead>
                          {!masked.amounts && <TableHead>مبلغ</TableHead>}
                          <TableHead>وقت‌دهی</TableHead>
                          <TableHead>پزشک</TableHead>
                          <TableHead>دستیار</TableHead>
                          <TableHead>پذیرش</TableHead>
                          <TableHead>بهداشت</TableHead>
                          <TableHead>رضایت</TableHead>
                          <TableHead>NPS</TableHead>
                          <TableHead>ریسک</TableHead>
                          <TableHead>پاسخگویی</TableHead>
                          <TableHead>وقت مجدد</TableHead>
                          <TableHead>توضیحات</TableHead>
                          <TableHead />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {contacts.map((c) => (
                          <TableRow
                            key={c.id}
                            className="cursor-pointer"
                            onClick={() => { setEditing(c); setDialogOpen(true) }}
                          >
                            <TableCell className="tabular-nums">{dash(c.patientExternalCode)}</TableCell>
                            <TableCell className="font-medium whitespace-nowrap">{dash(c.patientName)}</TableCell>
                            <TableCell className="whitespace-nowrap">{dash(c.doctorName)}</TableCell>
                            <TableCell className="tabular-nums whitespace-nowrap">{dash(c.visitDate)}</TableCell>
                            <TableCell className="tabular-nums whitespace-nowrap">{toPersianNum(c.contactDate)}</TableCell>
                            <TableCell className="max-w-40 truncate" title={c.serviceName ?? ""}>{dash(c.serviceName)}</TableCell>
                            {/*
                              One cell for the whole referral: who it went to,
                              and — once it happens — who treated the patient
                              and with what. Amber when nothing has come back
                              yet, which is the state the desk has to act on.
                            */}
                            <TableCell className="max-w-56">
                              {c.referredDoctorName ? (
                                <div className="flex flex-col gap-0.5 text-xs">
                                  <span className="whitespace-nowrap">→ {c.referredDoctorName}</span>
                                  {c.treatmentDoctorName ? (
                                    <span
                                      className="truncate text-muted-foreground"
                                      title={c.treatmentServiceNames.join("، ")}
                                    >
                                      درمان: {c.treatmentDoctorName}
                                      {c.treatmentServiceNames.length > 0
                                        ? ` — ${c.treatmentServiceNames.join("، ")}`
                                        : ""}
                                    </span>
                                  ) : (
                                    <span className="text-amber-600 dark:text-amber-400">
                                      در انتظار درمان
                                    </span>
                                  )}
                                </div>
                              ) : (
                                "—"
                              )}
                            </TableCell>
                            {!masked.amounts && (
                              <TableCell className="max-w-32 truncate" title={c.amountText ?? ""}>{dash(c.amountText)}</TableCell>
                            )}
                            <TableCell>{c.schedulingRating ? CRM_RATING_LABELS[c.schedulingRating] : "—"}</TableCell>
                            <TableCell>{c.doctorRating ? CRM_RATING_LABELS[c.doctorRating] : "—"}</TableCell>
                            <TableCell>{c.assistantRating ? CRM_RATING_LABELS[c.assistantRating] : "—"}</TableCell>
                            <TableCell>{c.receptionRating ? CRM_RATING_LABELS[c.receptionRating] : "—"}</TableCell>
                            <TableCell>{c.hygieneRating ? CRM_RATING_LABELS[c.hygieneRating] : "—"}</TableCell>
                            <TableCell className={cn("tabular-nums font-semibold", ratingTone(c.satisfaction))}>
                              {c.satisfaction === null ? "—" : `${toPersianNum(c.satisfaction)}٪`}
                            </TableCell>
                            <TableCell>
                              {c.npsBucket
                                ? <Badge variant="outline" className={NPS_TONE[c.npsBucket]}>{NPS_BUCKET_LABELS[c.npsBucket]}</Badge>
                                : "—"}
                            </TableCell>
                            <TableCell>
                              {c.riskLevel
                                ? <Badge variant="outline" className={RISK_TONE[c.riskLevel]}>{CRM_RISK_LABELS[c.riskLevel]}</Badge>
                                : "—"}
                            </TableCell>
                            <TableCell className="whitespace-nowrap">
                              {c.callResult ? CRM_CALL_RESULT_LABELS[c.callResult] : "—"}
                            </TableCell>
                            <TableCell className="max-w-40 truncate" title={c.rebookNote ?? ""}>{dash(c.rebookNote)}</TableCell>
                            <TableCell className="max-w-56 truncate" title={c.notes ?? ""}>{dash(c.notes)}</TableCell>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-muted-foreground hover:text-destructive"
                                onClick={(e) => { e.stopPropagation(); deleteContact(c) }}
                                aria-label="حذف تماس"
                              >
                                <Trash2 className="size-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}

                {total > PAGE_SIZE && (
                  <div className="mt-4 flex items-center justify-between">
                    <p className="text-sm text-muted-foreground">
                      {toPersianNum(total)} ردیف — صفحه {toPersianNum(page)} از {toPersianNum(totalPages)}
                    </p>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                        <ChevronRight className="size-4" /> قبلی
                      </Button>
                      <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                        بعدی <ChevronLeft className="size-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        ))}

        {/* ── امتیازدهی پزشکان ── */}
        <TabsContent value="doctors" className="mt-4 flex flex-col gap-4">
          <div className="flex justify-end">
            <Button variant="outline" onClick={exportScores}>
              <Download className="size-4" /> خروجی اکسل
            </Button>
          </div>
          <Card>
            <CardContent className="pt-6">
              {loadingAgg ? (
                <div className="grid gap-2">
                  {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10" />)}
                </div>
              ) : scores.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  هنوز تماسی با نام پزشک ثبت نشده است.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>پزشک</TableHead>
                        <TableHead>تعداد مراجعین</TableHead>
                        <TableHead>تعداد تماس</TableHead>
                        <TableHead>وقت‌دهی</TableHead>
                        <TableHead>پذیرش</TableHead>
                        <TableHead>دستیاران</TableHead>
                        <TableHead>پزشک</TableHead>
                        <TableHead>بهداشت</TableHead>
                        <TableHead>رضایت کلی</TableHead>
                        <TableHead>NPS</TableHead>
                        <TableHead>ریسک ریزش</TableHead>
                        <TableHead>وفاداری</TableHead>
                        <TableHead>VIP</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {scores.map((s) => (
                        <TableRow key={s.doctorName}>
                          <TableCell className="font-medium whitespace-nowrap">{s.doctorName}</TableCell>
                          <TableCell className="tabular-nums">{toPersianNum(s.patients)}</TableCell>
                          <TableCell className="tabular-nums">{toPersianNum(s.contacts)}</TableCell>
                          <TableCell className="tabular-nums">{s.scheduling === null ? "—" : toPersianNum(s.scheduling)}</TableCell>
                          <TableCell className="tabular-nums">{s.reception === null ? "—" : toPersianNum(s.reception)}</TableCell>
                          <TableCell className="tabular-nums">{s.assistant === null ? "—" : toPersianNum(s.assistant)}</TableCell>
                          <TableCell className="tabular-nums">{s.doctor === null ? "—" : toPersianNum(s.doctor)}</TableCell>
                          <TableCell className="tabular-nums">{s.hygiene === null ? "—" : toPersianNum(s.hygiene)}</TableCell>
                          <TableCell className={cn("tabular-nums font-semibold", ratingTone(s.satisfaction))}>
                            {s.satisfaction === null ? "—" : `${toPersianNum(s.satisfaction)}٪`}
                          </TableCell>
                          <TableCell className="tabular-nums">{s.nps === null ? "—" : toPersianNum(s.nps)}</TableCell>
                          <TableCell className="tabular-nums">
                            {s.churnRisk === null ? "—" : `${toPersianNum(s.churnRisk)}٪`}
                            {s.highRiskCount > 0 && (
                              <span className="ms-2 text-xs text-rose-600 dark:text-rose-400">
                                ({toPersianNum(s.highRiskCount)} پرریسک)
                              </span>
                            )}
                          </TableCell>
                          <TableCell className={cn("tabular-nums font-semibold", ratingTone(s.loyalty))}>
                            {s.loyalty === null ? "—" : toPersianNum(s.loyalty)}
                          </TableCell>
                          <TableCell>
                            {s.vip
                              ? <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300">VIP</Badge>
                              : <span className="text-xs text-muted-foreground">Normal</span>}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── ارجاع و درمان ── */}
        <TabsContent value="referrals" className="mt-4 flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              ارجاع پس از مشاوره بر پایه تماس‌های ثبت‌شده میز CRM — چه کسی ارجاع داده، به کدام پزشک،
              و درمان نزد چه کسی و با چه خدمتی انجام شده.
            </p>
            <Button variant="outline" onClick={exportReferrals}>
              <Download className="size-4" /> خروجی اکسل
            </Button>
          </div>

          {loadingAgg || !referrals ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
            </div>
          ) : referrals.totalReferrals === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                در این بازه ارجاعی ثبت نشده است. هنگام ثبت تماس، بخش «درمان ارجاعی» را پر کنید.
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Stat
                  label="کل ارجاع‌ها" value={formatCount(referrals.totalReferrals)}
                  icon={<Stethoscope className="size-4" />}
                />
                <Stat
                  label="درمان انجام‌شده" value={formatCount(referrals.treatedCount)}
                  hint={
                    referrals.completionRate === null
                      ? undefined
                      : `${toPersianNum(referrals.completionRate)}٪ از ارجاع‌ها`
                  }
                  icon={<HeartHandshake className="size-4" />}
                />
                <Stat
                  label="در انتظار درمان" value={formatCount(referrals.pendingCount)}
                  hint="ارجاع داده شده ولی درمانی ثبت نشده"
                  icon={<AlertTriangle className="size-4" />}
                />
                <Stat
                  label="درمان نزد پزشک دیگر" value={formatCount(referrals.redirectedCount)}
                  hint="درمان توسط کسی جز پزشکِ ارجاع‌شده"
                  icon={<Repeat className="size-4" />}
                />
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">تفکیک بر پایه پزشک ارجاع‌شده</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>پزشک ارجاع‌شده</TableHead>
                          <TableHead>ارجاع</TableHead>
                          <TableHead>بیمار</TableHead>
                          <TableHead>درمان‌شده</TableHead>
                          <TableHead>در انتظار</TableHead>
                          <TableHead>نرخ انجام</TableHead>
                          <TableHead>ارجاع‌دهنده</TableHead>
                          <TableHead>درمان توسط</TableHead>
                          <TableHead>خدمات گرفته‌شده</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {referrals.byDoctor.map((d) => (
                          <TableRow key={d.referredDoctorName}>
                            <TableCell className="font-medium whitespace-nowrap">
                              {d.referredDoctorName}
                            </TableCell>
                            <TableCell className="tabular-nums">{toPersianNum(d.referrals)}</TableCell>
                            <TableCell className="tabular-nums">{toPersianNum(d.patients)}</TableCell>
                            <TableCell className="tabular-nums">{toPersianNum(d.treated)}</TableCell>
                            <TableCell className="tabular-nums">
                              {d.pending > 0 ? (
                                <span className="text-amber-600 dark:text-amber-400">
                                  {toPersianNum(d.pending)}
                                </span>
                              ) : (
                                toPersianNum(0)
                              )}
                            </TableCell>
                            <TableCell className={cn("tabular-nums font-semibold", ratingTone(d.completionRate))}>
                              {d.completionRate === null ? "—" : `${toPersianNum(d.completionRate)}٪`}
                            </TableCell>
                            <TableCell><NameCounts items={d.fromDoctors} /></TableCell>
                            <TableCell><NameCounts items={d.treatedBy} /></TableCell>
                            <TableCell><NameCounts items={d.services} /></TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>

              {referrals.topServices.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">پرتکرارترین خدمات درمان ارجاعی</CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-wrap gap-2">
                    {referrals.topServices.map((svc) => (
                      <Badge key={svc.name} variant="secondary" className="gap-1.5">
                        {svc.name}
                        <span className="tabular-nums opacity-70">{toPersianNum(svc.count)}</span>
                      </Badge>
                    ))}
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </TabsContent>

        {/* ── روزهای پزشکان ── */}
        <TabsContent value="schedule" className="mt-4 flex flex-col gap-4">
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={exportSchedule}>
              <Download className="size-4" /> خروجی اکسل
            </Button>
            <Button variant="outline" onClick={() => setImportKind("schedule")}>
              <Upload className="size-4" /> ورود از فایل
            </Button>
          </div>
          <DoctorScheduleGrid
            names={scheduleGrid.names}
            values={scheduleGrid.map}
            onSaved={(next) => setSchedule(next)}
          />
        </TabsContent>
      </Tabs>

      <ContactDialog
        open={dialogOpen}
        onOpenChange={(v) => { setDialogOpen(v); if (!v) setEditing(null) }}
        contact={editing}
        defaultKind={editing?.kind ?? defaultKind}
        doctors={doctors}
        serviceCatalogue={serviceCatalogue}
        onSubmit={saveContact}
      />

      {importKind && (
        <ImportDialog
          kind={importKind}
          open
          onOpenChange={(v) => { if (!v) setImportKind(null) }}
          // An import writes contacts or the schedule; both live in these two
          // loaders, so refreshing them covers either kind.
          onImported={() => { void loadAggregates(); void loadContacts() }}
        />
      )}
    </div>
  )
}

/**
 * The `روزهای پزشکان` grid.
 *
 * Edits are held locally and written in one PUT: the sheet was filled in a
 * column at a time, and saving per cell would leave the week half-changed if a
 * request failed partway.
 */
function DoctorScheduleGrid({
  names, values, onSaved,
}: {
  names: string[]
  values: Map<string, string>
  onSaved: (next: ScheduleEntry[]) => void
}) {
  // Only the cells the user touched. Everything else reads through to the
  // server data, so a reload needs no copying back into local state.
  const [edits, setEdits] = useState<Map<string, string>>(new Map())
  const [newDoctor, setNewDoctor] = useState("")
  const [extraNames, setExtraNames] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  const allNames = useMemo(
    () => [...new Set([...names, ...extraNames])],
    [names, extraNames],
  )

  const cell = (doctor: string, weekday: number) => {
    const key = `${doctor}|${weekday}`
    return edits.get(key) ?? values.get(key) ?? ""
  }

  const setCell = (doctor: string, weekday: number, value: string) => {
    setEdits((prev) => new Map(prev).set(`${doctor}|${weekday}`, value))
  }

  const save = async () => {
    setSaving(true)
    try {
      const entries = allNames.flatMap((doctorName) =>
        CRM_WEEKDAYS.map((_, weekday) => ({
          doctorName,
          weekday,
          note: cell(doctorName, weekday) || null,
        })),
      )
      const next = await apiFetch<ScheduleEntry[]>("/api/crm-desk/schedule", {
        method: "PUT",
        body: JSON.stringify({ entries }),
      })
      onSaved(next)
      setEdits(new Map())
      toast.success("برنامه پزشکان ذخیره شد")
    } catch {
      toast.error("خطا در ذخیره برنامه")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle className="text-base">روزهای حضور پزشکان</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={newDoctor}
            onChange={(e) => setNewDoctor(e.target.value)}
            placeholder="افزودن پزشک"
            className="w-44"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const name = newDoctor.trim()
              if (!name || allNames.includes(name)) return
              setExtraNames((prev) => [...prev, name])
              setNewDoctor("")
            }}
          >
            <Plus className="size-4" /> افزودن
          </Button>
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? "در حال ذخیره…" : "ذخیره"}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {allNames.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            هنوز پزشکی ثبت نشده است. نام پزشک را از کادر بالا اضافه کنید.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-40">پزشک</TableHead>
                  {CRM_WEEKDAYS.map((d) => <TableHead key={d} className="min-w-32">{d}</TableHead>)}
                </TableRow>
              </TableHeader>
              <TableBody>
                {allNames.map((doctor) => (
                  <TableRow key={doctor}>
                    <TableCell className="font-medium whitespace-nowrap">{doctor}</TableCell>
                    {CRM_WEEKDAYS.map((_, weekday) => (
                      <TableCell key={weekday}>
                        <Input
                          value={cell(doctor, weekday)}
                          onChange={(e) => setCell(doctor, weekday, e.target.value)}
                          placeholder="—"
                          className="h-8"
                        />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
