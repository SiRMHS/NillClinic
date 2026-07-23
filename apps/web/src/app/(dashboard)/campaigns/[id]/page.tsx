"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useParams } from "next/navigation"
import { apiFetch } from "@/lib/api-client"
import { useAuth } from "@/stores/auth.store"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { formatDateTime } from "@/lib/date-utils"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import Link from "next/link"
import {
  Megaphone, RotateCcw, Users, CheckCircle2, TrendingUp, Target,
  ChevronLeft, Search, ArrowRight, PhoneCall, AlertTriangle,
} from "lucide-react"
import {
  type Lead, type LeadStatus, type Campaign,
  sourceIcons, sourceColors, sourceLabels, statusConfig,
  callStatusConfig, campaignStatusConfig,
  toPersianNum, isFollowUpOverdue, getInitials,
} from "@/components/leads/constants"

interface CampaignDetail extends Campaign {
  notes: string | null
  budget: number | null
  startDate: string | null
  endDate: string | null
  stats: { total: number; NEW: number; CONTACTED: number; CONVERTED: number; LOST: number; conversionRate: number }
}

const STATUS_FILTERS: { value: "all" | LeadStatus; label: string }[] = [
  { value: "all", label: "همه" },
  { value: "NEW", label: "جدید" },
  { value: "CONTACTED", label: "در پیگیری" },
  { value: "CONVERTED", label: "نوبت‌دار" },
  { value: "LOST", label: "از دست رفته" },
]

export default function CampaignDetailPage() {
  const params = useParams<{ id: string }>()
  const id = params.id
  const { hasPermission } = useAuth()
  const [campaign, setCampaign] = useState<CampaignDetail | null>(null)
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<"all" | LeadStatus>("all")

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [c, l] = await Promise.all([
        apiFetch<CampaignDetail>(`/api/campaigns/${id}`),
        apiFetch<Lead[]>(`/api/campaigns/${id}/leads`),
      ])
      setCampaign(c)
      setLeads(l)
    } catch {
      toast.error("خطا در بارگذاری کمپین")
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { void fetchData() }, [fetchData])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return leads.filter((l) => {
      const ms = statusFilter === "all" || l.status === statusFilter
      const mq = q === "" ||
        (l.fullName && l.fullName.toLowerCase().includes(q)) ||
        (l.mobile && l.mobile.includes(q))
      return ms && mq
    })
  }, [leads, search, statusFilter])

  const stats = campaign?.stats
  const funnel = stats ? [
    { label: "کل لیدها", value: stats.total, icon: Users, color: "text-blue-600", bg: "bg-blue-100 dark:bg-blue-950" },
    { label: "در پیگیری", value: stats.CONTACTED, icon: TrendingUp, color: "text-amber-600", bg: "bg-amber-100 dark:bg-amber-950" },
    { label: "نوبت‌دار", value: stats.CONVERTED, icon: CheckCircle2, color: "text-emerald-600", bg: "bg-emerald-100 dark:bg-emerald-950" },
    { label: "از دست رفته", value: stats.LOST, icon: AlertTriangle, color: "text-rose-600", bg: "bg-rose-100 dark:bg-rose-950" },
  ] : []

  const conversionRate = stats?.conversionRate ?? 0
  const contactRate = stats && stats.total > 0 ? Math.round(((stats.NEW + stats.CONTACTED) / stats.total) * 1000) / 10 : 0

  if (!loading && !campaign) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <Megaphone className="size-10 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">کمپین یافت نشد</p>
        <Link href="/campaigns"><Button variant="outline" size="sm">بازگشت به کمپین‌ها</Button></Link>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2 text-sm">
        <Link href="/campaigns" className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          <ArrowRight className="size-3.5" />
          کمپین‌ها
        </Link>
      </div>

      {loading ? (
        <Skeleton className="h-28 w-full rounded-xl" />
      ) : campaign && (
        <Card className="overflow-hidden">
          <CardContent className="p-5">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Megaphone className="size-5 text-violet-600" />
                  <h1 className="text-xl font-bold tracking-tight">{campaign.name}</h1>
                  <Badge className={cn("text-[10px] font-normal border-0", campaignStatusConfig[campaign.status].className)}>
                    {campaignStatusConfig[campaign.status].label}
                  </Badge>
                  {campaign.source && (
                    <Badge variant="outline" className="text-[10px] font-normal gap-1">
                      {sourceLabels[campaign.source]}
                    </Badge>
                  )}
                </div>
                {campaign.slug && (
                  <div className="text-xs text-muted-foreground mt-1.5" dir="ltr">
                    slug: {campaign.slug}
                  </div>
                )}
                {campaign.notes && (
                  <p className="text-sm text-muted-foreground mt-2 max-w-2xl">{campaign.notes}</p>
                )}
                <div className="flex items-center gap-3 mt-3 text-xs text-muted-foreground flex-wrap">
                  <span>ایجاد: {formatDateTime(campaign.createdAt)}</span>
                  {campaign.budget != null && <span>بودجه: {toPersianNum(campaign.budget)}</span>}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <div className="text-3xl font-bold text-emerald-600">{toPersianNum(conversionRate)}٪</div>
                <div className="text-xs text-muted-foreground inline-flex items-center gap-1">
                  <Target className="size-3" />
                  نرخ تبدیل
                </div>
              </div>
            </div>

            {/* Progress bars */}
            <div className="mt-5 space-y-3">
              <RateBar label="نرخ تماس" value={contactRate} color="bg-amber-500" />
              <RateBar label="نرخ تبدیل" value={conversionRate} color="bg-emerald-500" />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Funnel cards */}
      <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)
        ) : funnel.map((f) => (
          <Card key={f.label} className="overflow-hidden">
            <CardContent className="p-3 flex items-center gap-2.5">
              <div className={cn("rounded-lg p-2", f.bg)}>
                <f.icon className={cn("size-4", f.color)} />
              </div>
              <div>
                <div className="text-xl font-bold leading-none">{toPersianNum(f.value)}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">{f.label}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Leads table */}
      <Card className="overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 border-b">
          <div className="flex items-center gap-2">
            <Users className="size-4 text-violet-600" />
            <span className="text-sm font-medium">لیدهای این کمپین</span>
            <Badge variant="secondary" className="text-[10px]">{toPersianNum(filtered.length)}</Badge>
          </div>
          <div className="flex flex-1 items-center gap-2 sm:justify-end flex-wrap">
            <div className="relative w-full sm:w-56">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input placeholder="جستجو..." value={search} onChange={(e) => setSearch(e.target.value)} className="pr-9 h-9" />
            </div>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as "all" | LeadStatus)}>
              <SelectTrigger className="h-9 w-36 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATUS_FILTERS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={fetchData} variant="outline" size="sm" className="h-9">
              <RotateCcw className="size-3.5" />
            </Button>
          </div>
        </div>

        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="ps-4 text-xs uppercase text-muted-foreground">مخاطب</TableHead>
              <TableHead className="text-xs uppercase text-muted-foreground">تلفن</TableHead>
              <TableHead className="text-xs uppercase text-muted-foreground">وضعیت</TableHead>
              <TableHead className="text-xs uppercase text-muted-foreground hidden md:table-cell">آخرین تماس</TableHead>
              <TableHead className="text-xs uppercase text-muted-foreground hidden lg:table-cell">اپراتور</TableHead>
              <TableHead className="pe-4 text-xs uppercase text-muted-foreground text-end">عملیات</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}><TableCell colSpan={6} className="ps-4"><Skeleton className="h-10 w-full" /></TableCell></TableRow>
              ))
            ) : filtered.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={6} className="text-center py-12 text-sm text-muted-foreground">
                  لیدی در این کمپین ثبت نشده
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((lead) => {
                const SourceIcon = sourceIcons[lead.source]
                const overdue = isFollowUpOverdue(lead.nextFollowUpAt) && lead.status !== "LOST" && lead.status !== "CONVERTED"
                const latestCall = lead.calls[0]
                return (
                  <TableRow key={lead.id}>
                    <TableCell className="ps-4">
                      <div className="flex items-center gap-3 min-w-0">
                        <Avatar size="sm" className="size-8">
                          <AvatarFallback className={cn("text-[10px] font-medium", sourceColors[lead.source], "bg-muted")}>
                            {getInitials(lead.fullName)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <div className="font-medium text-sm truncate">{lead.fullName || "بدون نام"}</div>
                          <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                            <SourceIcon className={cn("size-3", sourceColors[lead.source])} />
                            {sourceLabels[lead.source]}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {lead.mobile ? (
                        <span dir="ltr" className="inline-flex items-center rounded-full bg-muted px-2.5 py-1 text-xs font-medium">{lead.mobile}</span>
                      ) : <span className="text-xs text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>
                      <Badge className={cn("text-[10px] font-normal border-0", statusConfig[lead.status].className)}>
                        {statusConfig[lead.status].label}
                      </Badge>
                      {overdue && (
                        <Badge variant="destructive" className="text-[10px] font-normal ms-1 gap-1">
                          <AlertTriangle className="size-2.5" />معوق
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {latestCall ? (
                        <div className="flex items-center gap-1.5 text-xs">
                          {(() => { const cfg = callStatusConfig[latestCall.callStatus]; const Icon = cfg.icon; return <Icon className={cn("size-3.5", cfg.color)} /> })()}
                          <span className="text-muted-foreground">{formatDateTime(latestCall.createdAt)}</span>
                        </div>
                      ) : <span className="text-xs text-muted-foreground">{formatDateTime(lead.createdAt)}</span>}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                      {lead.assignedUser?.fullName ?? <span className="text-muted-foreground/60">بدون تخصیص</span>}
                    </TableCell>
                    <TableCell className="pe-4 text-end">
                      {hasPermission("leads") ? (
                        <Link href="/my-leads">
                          <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-violet-600" title="پیگیری در لیدهای من">
                            <PhoneCall className="size-4" />
                          </Button>
                        </Link>
                      ) : null}
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  )
}

function RateBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold">{toPersianNum(value)}٪</span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${Math.min(value, 100)}%` }} />
      </div>
    </div>
  )
}
