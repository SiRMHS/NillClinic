"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
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
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { formatDateTime } from "@/lib/date-utils"
import { useDialLink } from "@/stores/telephony.store"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import Link from "next/link"
import {
  Users, Search, RotateCcw, PhoneCall, Clock, ChevronLeft, ChevronRight,
  AlertTriangle, CheckCircle2, Calendar, Hand, Headphones,
  MessageSquare, Inbox, TrendingUp, X,
} from "lucide-react"
import { CallFlowDialog, type CallFlowData } from "@/components/leads/call-flow-dialog"
import { LeadChatHistory } from "@/components/leads/lead-chat-history"
import {
  LeadMetadataPanel, hasVisibleMetadata,
} from "@/components/leads/lead-metadata-panel"
import {
  type Lead, type LeadStatus, type Campaign,
  sourceIcons, sourceColors, sourceLabels, statusConfig,
  callStatusConfig,
  toPersianNum, isFollowUpOverdue, getInitials,
} from "@/components/leads/constants"

const STATUS_FILTERS: { value: "all" | LeadStatus; label: string }[] = [
  { value: "all", label: "همه" },
  { value: "NEW", label: "جدید" },
  { value: "CONTACTED", label: "در پیگیری" },
  { value: "CONVERTED", label: "نوبت‌دار" },
  { value: "LOST", label: "از دست رفته" },
]

const PAGE_SIZE = 10

export default function MyLeadsPage() {
  const { user } = useAuth()
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<"all" | LeadStatus>("all")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [openLeadId, setOpenLeadId] = useState<string | null>(null)
  const [callDialogLead, setCallDialogLead] = useState<Lead | null>(null)
  const [page, setPage] = useState(1)
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [campaignFilter, setCampaignFilter] = useState<string>("all")

  const fetchData = useCallback(async () => {
    if (!user?.id) return
    setLoading(true)
    try {
      const [data, camps] = await Promise.all([
        apiFetch<Lead[]>(`/api/leads?assignedUserId=${user.id}`),
        apiFetch<Campaign[]>("/api/campaigns"),
      ])
      setLeads(data)
      setCampaigns(camps)
    } catch {
      toast.error("خطا در بارگذاری لیدها")
    } finally {
      setLoading(false)
    }
  }, [user?.id])

  useEffect(() => { void fetchData() }, [fetchData])

  const openLead = useMemo(
    () => leads.find((l) => l.id === openLeadId) ?? null,
    [leads, openLeadId]
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return leads.filter((l) => {
      const matchStatus = statusFilter === "all" || l.status === statusFilter
      const matchCampaign = campaignFilter === "all" || l.campaignId === campaignFilter
      const matchSearch = q === "" ||
        (l.fullName && l.fullName.toLowerCase().includes(q)) ||
        (l.mobile && l.mobile.includes(q))
      return matchStatus && matchCampaign && matchSearch
    })
  }, [leads, search, statusFilter, campaignFilter])

  useEffect(() => { setPage(1); setSelected(new Set()) }, [search, statusFilter, campaignFilter, leads.length])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const stats = useMemo(() => ({
    total: leads.length,
    new: leads.filter((l) => l.status === "NEW").length,
    inProgress: leads.filter((l) => l.status === "CONTACTED").length,
    converted: leads.filter((l) => l.status === "CONVERTED").length,
    overdue: leads.filter((l) => isFollowUpOverdue(l.nextFollowUpAt) && l.status !== "LOST" && l.status !== "CONVERTED").length,
  }), [leads])

  const updateLead = (updated: Lead) => {
    setLeads((prev) => prev.map((l) => (l.id === updated.id ? updated : l)))
  }

  const handleCallSubmit = async (data: CallFlowData) => {
    if (!callDialogLead) return
    try {
      const result = await apiFetch<{ lead: Lead }>(`/api/leads/${callDialogLead.id}/calls`, {
        method: "POST",
        body: JSON.stringify(data),
      })
      updateLead(result.lead)
      toast.success(data.appointment ? "نوبت ثبت شد" : "تماس ثبت شد")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "خطا در ثبت تماس")
    }
  }

  const changeStatus = async (lead: Lead, status: LeadStatus) => {
    try {
      const updated = await apiFetch<Lead>(`/api/leads/${lead.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      })
      updateLead(updated)
      toast.success("وضعیت به‌روزرسانی شد")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "خطا در تغییر وضعیت")
    }
  }

  const changeCampaign = async (lead: Lead, campaignId: string | null) => {
    try {
      const updated = await apiFetch<Lead>(`/api/leads/${lead.id}/campaign`, {
        method: "PATCH",
        body: JSON.stringify({ campaignId }),
      })
      updateLead(updated)
      toast.success("کمپین به‌روزرسانی شد")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "خطا در تغییر کمپین")
    }
  }

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const allOnPageSelected = paged.length > 0 && paged.every((l) => selected.has(l.id))
  const toggleSelectAll = () => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allOnPageSelected) paged.forEach((l) => next.delete(l.id))
      else paged.forEach((l) => next.add(l.id))
      return next
    })
  }

  const statCards = [
    { label: "لیدهای من", value: stats.total, icon: Users, color: "text-violet-600", bg: "bg-violet-100 dark:bg-violet-950" },
    { label: "جدید", value: stats.new, icon: Inbox, color: "text-blue-600", bg: "bg-blue-100 dark:bg-blue-950" },
    { label: "در پیگیری", value: stats.inProgress, icon: TrendingUp, color: "text-amber-600", bg: "bg-amber-100 dark:bg-amber-950" },
    { label: "نوبت‌دار", value: stats.converted, icon: CheckCircle2, color: "text-emerald-600", bg: "bg-emerald-100 dark:bg-emerald-950" },
    { label: "فالوآپ معوق", value: stats.overdue, icon: AlertTriangle, color: "text-rose-600", bg: "bg-rose-100 dark:bg-rose-950" },
  ]

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Headphones className="size-6 text-violet-600" />
            <h1 className="text-2xl font-bold tracking-tight">لیدهای من</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            لیدهایی که برداشته‌اید؛ پیگیری، ثبت تماس و تاریخچه یک‌طرفه
          </p>
        </div>
        <Button onClick={fetchData} variant="outline" size="sm" className="shrink-0">
          <RotateCcw className="size-3.5" />
          بروزرسانی
        </Button>
      </div>

      {/* Stats */}
      <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
        {statCards.map((s) => (
          <Card key={s.label} className="overflow-hidden">
            <CardContent className="p-3 flex items-center gap-2.5">
              <div className={cn("rounded-lg p-2", s.bg)}>
                <s.icon className={cn("size-4", s.color)} />
              </div>
              <div>
                <div className="text-xl font-bold leading-none">{toPersianNum(s.value)}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">{s.label}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Table card */}
      <Card className="overflow-hidden">
        {/* Toolbar */}
        <div className="flex flex-col gap-3 p-4 border-b">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="relative w-full sm:w-72">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                placeholder="جستجو نام یا تلفن..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pr-9 h-9"
              />
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {STATUS_FILTERS.map((s) => (
                <Button
                  key={s.value}
                  variant={statusFilter === s.value ? "default" : "outline"}
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => setStatusFilter(s.value)}
                >
                  {s.label}
                </Button>
              ))}
            </div>
            {campaigns.length > 0 && (
              <Select value={campaignFilter} onValueChange={(v) => setCampaignFilter(v ?? "all")}>
                <SelectTrigger className="h-9 w-44 text-xs sm:ms-auto">
                  <SelectValue placeholder="همه کمپین‌ها" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">همه کمپین‌ها</SelectItem>
                  {campaigns.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Bulk action bar */}
          {selected.size > 0 && (
            <div className="flex items-center justify-between gap-2 rounded-lg bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-900 px-3 py-2">
              <span className="text-xs font-medium text-violet-700 dark:text-violet-300">
                {toPersianNum(selected.size)} لید انتخاب شده
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setSelected(new Set())}
              >
                <X className="size-3" />
                پاک کردن انتخاب
              </Button>
            </div>
          )}
        </div>

        {/* Table */}
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="w-10 ps-4">
                <Checkbox
                  checked={allOnPageSelected}
                  onCheckedChange={toggleSelectAll}
                  aria-label="انتخاب همه"
                />
              </TableHead>
              <TableHead className="text-xs uppercase text-muted-foreground">مخاطب</TableHead>
              <TableHead className="text-xs uppercase text-muted-foreground">تلفن</TableHead>
              <TableHead className="text-xs uppercase text-muted-foreground">وضعیت</TableHead>
              <TableHead className="text-xs uppercase text-muted-foreground hidden xl:table-cell">کمپین</TableHead>
              <TableHead className="text-xs uppercase text-muted-foreground hidden md:table-cell">آخرین فعالیت</TableHead>
              <TableHead className="text-xs uppercase text-muted-foreground hidden lg:table-cell">فالوآپ بعدی</TableHead>
              <TableHead className="text-xs uppercase text-muted-foreground text-end pe-4">عملیات</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={8} className="ps-4">
                    <Skeleton className="h-10 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : paged.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={8} className="text-center py-16">
                  <div className="flex flex-col items-center gap-2">
                    <div className="size-12 rounded-full bg-muted flex items-center justify-center">
                      <Users className="size-5 text-muted-foreground" />
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {leads.length === 0 ? "هنوز لیدی برداشته‌اید" : "موردی یافت نشد"}
                    </p>
                    {leads.length === 0 && (
                      <Link href="/leads">
                        <Button variant="outline" size="sm" className="mt-1 gap-1.5">
                          <Hand className="size-3.5" />
                          برداشتن لید از صف
                        </Button>
                      </Link>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              paged.map((lead) => {
                const SourceIcon = sourceIcons[lead.source]
                const overdue = isFollowUpOverdue(lead.nextFollowUpAt) && lead.status !== "LOST" && lead.status !== "CONVERTED"
                const latestCall = lead.calls[0]
                const isSelected = selected.has(lead.id)
                return (
                  <TableRow
                    key={lead.id}
                    data-state={isSelected ? "selected" : undefined}
                    className="cursor-pointer group"
                    onClick={() => setOpenLeadId(lead.id)}
                  >
                    <TableCell className="ps-4" onClick={(e) => { e.stopPropagation(); toggleSelect(lead.id) }}>
                      <Checkbox checked={isSelected} aria-label="انتخاب" />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-3 min-w-0">
                        <Avatar size="sm" className="size-9">
                          <AvatarFallback className={cn("text-xs font-medium", sourceColors[lead.source], "bg-muted")}>
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
                        <span dir="ltr" className="inline-flex items-center rounded-full bg-muted px-2.5 py-1 text-xs font-medium">
                          {lead.mobile}
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge className={cn("text-[10px] font-normal border-0", statusConfig[lead.status].className)}>
                        {statusConfig[lead.status].label}
                      </Badge>
                      {overdue && (
                        <Badge variant="destructive" className="text-[10px] font-normal ms-1 gap-1">
                          <AlertTriangle className="size-2.5" />
                          معوق
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="hidden xl:table-cell">
                      {lead.campaign ? (
                        <Link
                          href={`/campaigns/${lead.campaign.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center rounded-full bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 px-2.5 py-1 text-xs font-medium hover:bg-violet-100 dark:hover:bg-violet-900/50 transition"
                        >
                          {lead.campaign.name}
                        </Link>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {latestCall ? (
                        <div className="flex items-center gap-1.5 text-xs">
                          {(() => {
                            const cfg = callStatusConfig[latestCall.callStatus]
                            const Icon = cfg.icon
                            return <Icon className={cn("size-3.5", cfg.color)} />
                          })()}
                          <span className="text-muted-foreground">{formatDateTime(latestCall.createdAt)}</span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">{formatDateTime(lead.createdAt)}</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      {lead.nextFollowUpAt && lead.status !== "CONVERTED" && lead.status !== "LOST" ? (
                        <span className={cn("text-xs inline-flex items-center gap-1", overdue ? "text-rose-600 font-medium" : "text-muted-foreground")}>
                          <Clock className="size-3" />
                          {formatDateTime(lead.nextFollowUpAt)}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="pe-4">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="text-violet-600 hover:bg-violet-50 dark:hover:bg-violet-950"
                          title="ثبت تماس"
                          onClick={(e) => { e.stopPropagation(); setCallDialogLead(lead) }}
                        >
                          <PhoneCall className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="text-muted-foreground group-hover:text-foreground"
                          title="باز کردن پیگیری"
                          onClick={(e) => { e.stopPropagation(); setOpenLeadId(lead.id) }}
                        >
                          <ChevronLeft className="size-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>

        {/* Pagination */}
        {!loading && filtered.length > 0 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-4 border-t">
            <span className="text-xs text-muted-foreground">
              نمایش {toPersianNum((page - 1) * PAGE_SIZE + 1)} تا {toPersianNum(Math.min(page * PAGE_SIZE, filtered.length))} از {toPersianNum(filtered.length)} لید
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronRight className="size-3.5" />
                قبلی
              </Button>
              <span className="text-xs text-muted-foreground px-1">
                {toPersianNum(page)} / {toPersianNum(totalPages)}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                بعدی
                <ChevronLeft className="size-3.5" />
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Lead detail sheet */}
      <Sheet open={!!openLeadId} onOpenChange={(v) => { if (!v) setOpenLeadId(null) }}>
        <SheetContent side="left" size="xl" className="p-0 gap-0 overflow-hidden">
          {openLead && (
            <LeadDetail
              lead={openLead}
              campaigns={campaigns}
              onUpdated={updateLead}
              onCall={() => setCallDialogLead(openLead)}
              onStatusChange={(s) => void changeStatus(openLead, s)}
              onCampaignChange={(cid) => void changeCampaign(openLead, cid)}
            />
          )}
        </SheetContent>
      </Sheet>

      <CallFlowDialog
        lead={callDialogLead}
        open={!!callDialogLead}
        onOpenChange={(v) => { if (!v) setCallDialogLead(null) }}
        onSubmit={handleCallSubmit}
      />
    </div>
  )
}

function LeadDetail({
  lead, campaigns, onUpdated, onCall, onStatusChange, onCampaignChange,
}: {
  lead: Lead
  campaigns: Campaign[]
  onUpdated: (lead: Lead) => void
  onCall: () => void
  onStatusChange: (status: LeadStatus) => void
  onCampaignChange: (campaignId: string | null) => void
}) {
  const SourceIcon = sourceIcons[lead.source]
  const dialHref = useDialLink()(lead.mobile)
  const overdue = isFollowUpOverdue(lead.nextFollowUpAt) && lead.status !== "LOST" && lead.status !== "CONVERTED"
  const latestAppointment = lead.appointments[0]

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      <SheetHeader className="border-b p-4 shrink-0">
        <div className="flex items-start gap-3 min-w-0">
          <Avatar size="lg" className="size-11 shrink-0">
            <AvatarFallback className={cn("font-medium", sourceColors[lead.source], "bg-muted")}>
              {getInitials(lead.fullName)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <SheetTitle className="truncate text-lg">{lead.fullName || "بدون نام"}</SheetTitle>
              <Badge className={cn("text-xs border-0 shrink-0", statusConfig[lead.status].className)}>
                {statusConfig[lead.status].label}
              </Badge>
            </div>
            <SheetDescription className="flex items-center gap-2 flex-wrap mt-1">
              {lead.mobile && dialHref ? (
                <a
                  href={dialHref}
                  dir="ltr"
                  className="inline-flex items-center gap-1 text-xs hover:text-violet-600 transition"
                >
                  <PhoneCall className="size-3" />
                  {lead.mobile}
                </a>
              ) : (
                <span className="text-xs">بدون شماره</span>
              )}
              <span className="text-muted-foreground/50">·</span>
              <span className="inline-flex items-center gap-1 text-xs">
                <SourceIcon className={cn("size-3", sourceColors[lead.source])} />
                {sourceLabels[lead.source]}
              </span>
            </SheetDescription>
          </div>
        </div>

        <div className="flex items-center gap-2 mt-3 flex-wrap">
          <Button size="sm" className="gap-1.5" onClick={onCall}>
            <PhoneCall className="size-3.5" />
            ثبت تماس
          </Button>
          <div className="flex items-center gap-1 rounded-lg border p-0.5">
            {(["NEW", "CONTACTED", "CONVERTED", "LOST"] as LeadStatus[]).map((s) => (
              <button
                key={s}
                onClick={() => onStatusChange(s)}
                className={cn(
                  "px-2.5 py-1 rounded-md text-xs font-medium transition",
                  lead.status === s
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted"
                )}
              >
                {statusConfig[s].label}
              </button>
            ))}
          </div>
          {overdue && (
            <Badge variant="destructive" className="text-[10px] gap-1">
              <AlertTriangle className="size-2.5" />
              فالوآپ معوق
            </Badge>
          )}
        </div>
      </SheetHeader>

      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-3 overflow-hidden">
        {/* Chat column */}
        <div className="lg:col-span-2 flex flex-col min-h-0 border-e overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2.5 border-b bg-muted/30">
            <MessageSquare className="size-4 text-violet-600" />
            <span className="text-sm font-medium">تاریخچه پیگیری</span>
            <span className="text-[10px] text-muted-foreground ms-auto">یک‌طرفه</span>
          </div>
          <LeadChatHistory lead={lead} onUpdated={onUpdated} />
        </div>

        {/* Details column */}
        <div className="hidden lg:flex flex-col min-h-0 overflow-y-auto p-4 space-y-4">
          <DetailSection title="اطلاعات تماس">
            <DetailRow label="نام کامل" value={lead.fullName || "—"} />
            <DetailRow label="تلفن" value={lead.mobile ? <span dir="ltr">{lead.mobile}</span> : "—"} />
            <DetailRow label="منبع" value={sourceLabels[lead.source]} />
            <DetailRow label="ایجاد در" value={formatDateTime(lead.createdAt)} />
            {lead.contactedAt && <DetailRow label="اولین تماس" value={formatDateTime(lead.contactedAt)} />}
          </DetailSection>

          <DetailSection title="کمپین">
            {campaigns.length > 0 ? (
              <Select
                value={lead.campaignId ?? "none"}
                onValueChange={(v) => onCampaignChange(v === "none" ? null : v)}
              >
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="بدون کمپین">
                    {lead.campaign?.name ?? "بدون کمپین"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">بدون کمپین</SelectItem>
                  {campaigns.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="text-xs text-muted-foreground">
                هنوز کمپینی ساخته نشده.{" "}
                <Link href="/campaigns" className="text-violet-600 hover:underline">ساخت کمپین</Link>
              </div>
            )}
          </DetailSection>

          {latestAppointment && (
            <DetailSection title="آخرین نوبت" icon={Calendar} accent="emerald">
              <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 p-3 text-sm">
                <div className="font-semibold text-emerald-700 dark:text-emerald-300">
                  {toPersianNum(latestAppointment.reserveDate)} — {toPersianNum(latestAppointment.reserveTime)}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {latestAppointment.doctorName}
                  {latestAppointment.serviceName && ` · ${latestAppointment.serviceName}`}
                </div>
              </div>
            </DetailSection>
          )}

          {lead.nextFollowUpAt && lead.status !== "CONVERTED" && lead.status !== "LOST" && (
            <DetailSection title="فالوآپ بعدی" icon={Clock} accent={overdue ? "rose" : "amber"}>
              <div className={cn(
                "rounded-lg border p-3 text-sm",
                overdue
                  ? "bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300"
                  : "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900 text-amber-700 dark:text-amber-300"
              )}>
                {formatDateTime(lead.nextFollowUpAt)}
              </div>
            </DetailSection>
          )}

          {hasVisibleMetadata(lead.metadata) && (
            <DetailSection title="اطلاعات ورودی">
              <LeadMetadataPanel metadata={lead.metadata} />
            </DetailSection>
          )}

          <DetailSection title="آمار فعالیت">
            <div className="grid grid-cols-3 gap-2 text-center">
              <StatChip label="تماس" value={lead.calls.length} />
              <StatChip label="یادداشت" value={lead.interactions.filter((i) => i.type === "NOTE").length} />
              <StatChip label="نوبت" value={lead.appointments.length} />
            </div>
          </DetailSection>
        </div>
      </div>
    </div>
  )
}

function DetailSection({
  title, children, icon: Icon, accent,
}: {
  title: string
  children: React.ReactNode
  icon?: typeof Clock
  accent?: "emerald" | "amber" | "rose"
}) {
  const accentColor = accent === "emerald" ? "text-emerald-600" : accent === "rose" ? "text-rose-600" : accent === "amber" ? "text-amber-600" : "text-muted-foreground"
  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
        {Icon && <Icon className={cn("size-3.5", accentColor)} />}
        {title}
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="font-medium text-end min-w-0 truncate">{value}</span>
    </div>
  )
}

function StatChip({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-2">
      <div className="text-lg font-bold leading-none">{toPersianNum(value)}</div>
      <div className="text-[10px] text-muted-foreground mt-1">{label}</div>
    </div>
  )
}
