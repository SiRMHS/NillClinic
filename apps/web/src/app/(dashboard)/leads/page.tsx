"use client"

import { useCallback, useEffect, useState } from "react"
import { apiFetch } from "@/lib/api-client"
import { useAuth } from "@/stores/auth.store"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Skeleton } from "@/components/ui/skeleton"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { formatDateTime } from "@/lib/date-utils"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import Link from "next/link"
import {
  Users, Plus, Search, Clock, PhoneCall, Calendar, RotateCcw,
  ChevronDown, ChevronUp, Headphones, AlertTriangle, CheckCircle2,
  StickyNote, FileText, MessageSquare, UserPlus, Trash2, Hand,
  ExternalLink, UserCheck, ChevronLeft, ChevronRight,
} from "lucide-react"
import { CallFlowDialog, type CallFlowData } from "@/components/leads/call-flow-dialog"
import { ReceptionsPanel } from "@/components/leads/receptions-panel"
import {
  type Agent, type Lead,
  sourceIcons, sourceColors, sourceLabels,
  statusConfig, callStatusConfig, callOutcomeConfig,
  toPersianNum, isFollowUpOverdue, getInitials,
} from "@/components/leads/constants"

export default function LeadsPage() {
  const { user: currentUser, hasPermission } = useAuth()
  const isSuperAdmin = hasPermission("*")
  const [leads, setLeads] = useState<Lead[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [activeTab, setActiveTab] = useState("all")
  const [expandedLead, setExpandedLead] = useState<string | null>(null)
  const [callDialogLead, setCallDialogLead] = useState<Lead | null>(null)
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 20
  const [name, setName] = useState("")
  const [phone, setPhone] = useState("")
  const [source, setSource] = useState<Lead["source"]>("MANUAL")
  const [submitting, setSubmitting] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (activeTab === "followup") params.set("followUp", "pending")
      else if (activeTab === "appointments") params.set("hasAppointment", "true")

      const [leadsData, agentsData] = await Promise.all([
        apiFetch<Lead[]>(`/api/leads?${params}`),
        apiFetch<Agent[]>("/api/leads/agents"),
      ])
      setLeads(leadsData)
      setAgents(agentsData)
    } catch {
      toast.error("خطا در بارگذاری داده‌ها")
    } finally {
      setLoading(false)
    }
  }, [activeTab])

  useEffect(() => { fetchData() }, [fetchData])

  // Auto-check patient match for all loaded leads
  useEffect(() => {
    for (const l of leads) {
      if (!(l.id in patientMatches) && l.mobile) void checkPatientMatch(l.id)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leads])

  const updateLeadInList = (updated: Lead) => {
    setLeads((prev) => prev.map((l) => (l.id === updated.id ? updated : l)))
  }

  const handleCallSubmit = async (data: CallFlowData) => {
    if (!callDialogLead) return
    try {
      const result = await apiFetch<{ lead: Lead }>(`/api/leads/${callDialogLead.id}/calls`, {
        method: "POST",
        body: JSON.stringify(data),
      })
      updateLeadInList(result.lead)
      toast.success(data.appointment ? "نوبت با موفقیت ثبت شد" : "تماس ثبت شد")
      fetchData()
    } catch {
      toast.error("خطا در ثبت تماس")
    }
  }

  const assignLead = async (leadId: string, assignedUserId: string | null) => {
    try {
      const updated = await apiFetch<Lead>(`/api/leads/${leadId}/assign`, {
        method: "PATCH",
        body: JSON.stringify({ assignedUserId }),
      })
      updateLeadInList(updated)
      toast.success("اپراتور تخصیص داده شد")
      fetchData()
    } catch {
      toast.error("خطا در تخصیص")
    }
  }

  const completeFollowUp = async (leadId: string, followUpId: string) => {
    try {
      const result = await apiFetch<{ lead: Lead }>(`/api/leads/${leadId}/follow-ups/${followUpId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "COMPLETED" }),
      })
      updateLeadInList(result.lead)
      toast.success("فالوآپ انجام شد")
    } catch {
      toast.error("خطا در بروزرسانی")
    }
  }

  const deleteLead = async (leadId: string, leadName: string | null) => {
    if (!confirm(`آیا از حذف لید "${leadName || 'بدون نام'}" اطمینان دارید؟ این عمل برگشت‌ناپذیر است.`)) return
    try {
      await apiFetch(`/api/leads/${leadId}`, { method: "DELETE" })
      setLeads((prev) => prev.filter((l) => l.id !== leadId))
      toast.success("لید حذف شد")
    } catch { toast.error("خطا در حذف لید") }
  }

  const createLead = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !phone.trim()) return
    setSubmitting(true)
    try {
      const lead = await apiFetch<Lead>("/api/leads", {
        method: "POST",
        body: JSON.stringify({ source, fullName: name, mobile: phone, metadata: { note: "ثبت توسط اپراتور" } }),
      })
      setLeads((prev) => [lead, ...prev])
      setName("")
      setPhone("")
      toast.success("مخاطب جدید ثبت شد")
      fetchData()
    } catch {
      toast.error("خطا در ثبت مخاطب")
    } finally {
      setSubmitting(false)
    }
  }

  const filtered = leads.filter((l) => {
    const matchStatus = statusFilter === "all" || l.status === statusFilter
    const searchLower = search.toLowerCase()
    const matchSearch = search === "" ||
      (l.fullName && l.fullName.toLowerCase().includes(searchLower)) ||
      (l.mobile && l.mobile.includes(search)) ||
      JSON.stringify(l.metadata).toLowerCase().includes(searchLower)
    const matchTab = activeTab === "all" ||
      (activeTab === "followup" && l.followUps.some((f) => f.status === "PENDING"))
    return matchStatus && matchSearch && matchTab
  })

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  // Reset page when filters change
  useEffect(() => { setPage(1) }, [statusFilter, search, activeTab, leads.length])

  const [patientMatches, setPatientMatches] = useState<Record<string, { id: string; externalCode: number; fullName: string | null } | null>>({})
  const checkPatientMatch = async (leadId: string) => {
    if (leadId in patientMatches) return
    try {
      const result = await apiFetch<{ id: string; externalCode: number; fullName: string | null } | null>(`/api/leads/${leadId}/match-patient`)
      setPatientMatches((prev) => ({ ...prev, [leadId]: result }))
    } catch { setPatientMatches((prev) => ({ ...prev, [leadId]: null })) }
  }

  const pickLead = async (leadId: string) => {
    if (!currentUser?.id) return
    try {
      const updated = await apiFetch<Lead>(`/api/leads/${leadId}/assign`, {
        method: "PATCH",
        body: JSON.stringify({ assignedUserId: currentUser.id }),
      })
      updateLeadInList(updated)
      toast.success("لید برداشته شد")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "خطا در برداشتن لید")
    }
  }

  const stats = {
    total: leads.length,
    new: leads.filter((l) => l.status === "NEW").length,
    inProgress: leads.filter((l) => l.status === "CONTACTED").length,
    converted: leads.filter((l) => l.status === "CONVERTED").length,
    overdueFollowUps: leads.filter((l) => isFollowUpOverdue(l.nextFollowUpAt) && l.status !== "LOST" && l.status !== "CONVERTED").length,
    appointments: leads.filter((l) => l.appointments.length > 0).length,
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Headphones className="size-6 text-violet-600" />
            <h1 className="text-2xl font-bold tracking-tight">مرکز تماس و مخاطبان</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            مدیریت لیدها، ثبت تماس، نوبت‌دهی و پیگیری فالوآپ
          </p>
        </div>
        <Button onClick={fetchData} variant="outline" size="sm" className="shrink-0">
          <RotateCcw className="size-3.5" />
          بروزرسانی
        </Button>
      </div>

      {/* Stats */}
      <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
        {[
          { label: "کل لیدها", value: stats.total, icon: Users, color: "text-blue-600", bg: "bg-blue-100 dark:bg-blue-900" },
          { label: "جدید", value: stats.new, icon: UserPlus, color: "text-sky-600", bg: "bg-sky-100 dark:bg-sky-900" },
          { label: "در پیگیری", value: stats.inProgress, icon: PhoneCall, color: "text-amber-600", bg: "bg-amber-100 dark:bg-amber-900" },
          { label: "نوبت‌دار", value: stats.converted, icon: CheckCircle2, color: "text-emerald-600", bg: "bg-emerald-100 dark:bg-emerald-900" },
          { label: "فالوآپ معوق", value: stats.overdueFollowUps, icon: AlertTriangle, color: "text-rose-600", bg: "bg-rose-100 dark:bg-rose-900" },
          { label: "نوبت ثبت‌شده", value: stats.appointments, icon: Calendar, color: "text-violet-600", bg: "bg-violet-100 dark:bg-violet-900" },
        ].map((stat) => (
          <Card key={stat.label} className="overflow-hidden">
            <CardContent className="p-3 flex items-center gap-2.5">
              <div className={cn("rounded-lg p-2", stat.bg)}>
                <stat.icon className={cn("size-4", stat.color)} />
              </div>
              <div>
                <div className="text-xl font-bold leading-none">{toPersianNum(stat.value)}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">{stat.label}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-4">
        {/* Main content */}
        <div className="lg:col-span-3 flex flex-col gap-4">
          {/* Filters */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <div className="relative w-full sm:w-56">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                placeholder="جستجو نام، تلفن..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pr-9 h-9"
              />
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {(["all", "NEW", "CONTACTED", "CONVERTED", "LOST"] as const).map((s) => (
                <Button
                  key={s}
                  variant={statusFilter === s ? "default" : "outline"}
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => setStatusFilter(s)}
                >
                  {s === "all" ? "همه" : statusConfig[s].label}
                </Button>
              ))}
            </div>
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList>
              <TabsTrigger value="all">همه لیدها</TabsTrigger>
              <TabsTrigger value="followup" className="gap-1.5">
                فالوآپ‌ها
                {stats.overdueFollowUps > 0 && (
                  <span className="size-4 rounded-full bg-rose-500 text-white text-[10px] flex items-center justify-center">
                    {toPersianNum(stats.overdueFollowUps)}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="appointments">نوبت‌ها</TabsTrigger>
            </TabsList>

            <TabsContent value="appointments" className="mt-4">
              <ReceptionsPanel />
            </TabsContent>

            {(["all", "followup"] as const).map((tab) => (
              <TabsContent key={tab} value={tab} className="mt-4">
                {loading ? (
                  <div className="space-y-3">
                    {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}
                  </div>
                ) : filtered.length === 0 ? (
                  <Card>
                    <CardContent className="py-16 text-center">
                      <Users className="size-10 mx-auto text-muted-foreground/40 mb-3" />
                      <p className="text-sm text-muted-foreground">موردی یافت نشد</p>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="space-y-3">
                    {paged.map((lead) => (
                      <LeadCard
                        key={lead.id}
                        lead={lead}
                        agents={agents}
                        expanded={expandedLead === lead.id}
                        currentUserId={currentUser?.id}
                        isSuperAdmin={isSuperAdmin}
                        patientMatch={patientMatches[lead.id] ?? null}
                        onToggle={() => {
                          if (expandedLead !== lead.id) checkPatientMatch(lead.id)
                          setExpandedLead(expandedLead === lead.id ? null : lead.id)
                        }}
                        onPick={() => pickLead(lead.id)}
                        onCall={() => setCallDialogLead(lead)}
                        onAssign={(agentId) => assignLead(lead.id, agentId)}
                        onCompleteFollowUp={(fuId) => completeFollowUp(lead.id, fuId)}
                        onDelete={() => deleteLead(lead.id, lead.fullName)}
                      />
                    ))}
                  </div>
                )}
                {totalPages > 1 && (
                  <div className="flex items-center justify-center gap-2 pt-4">
                    <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                      <ChevronRight className="size-3" /> قبلی
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      {toPersianNum(Math.min(page, totalPages))} از {toPersianNum(totalPages)}
                    </span>
                    <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                      بعدی <ChevronLeft className="size-3" />
                    </Button>
                  </div>
                )}
              </TabsContent>
            ))}
          </Tabs>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Plus className="size-4 text-violet-600" />
                ثبت مخاطب جدید
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={createLead} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="name">نام</Label>
                  <Input id="name" required placeholder="سارا محمدی" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="phone">تلفن</Label>
                  <Input id="phone" type="tel" required placeholder="09123456789" value={phone} onChange={(e) => setPhone(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="source">منبع</Label>
                  <Select value={source} onValueChange={(v) => setSource(v as Lead["source"])}>
                    <SelectTrigger id="source"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(sourceLabels).map(([k, v]) => (
                        <SelectItem key={k} value={k}>{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button type="submit" disabled={submitting} className="w-full">
                  {submitting ? "در حال ثبت..." : "افزودن به صف"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>

      <CallFlowDialog
        lead={callDialogLead}
        open={!!callDialogLead}
        onOpenChange={(v) => { if (!v) setCallDialogLead(null) }}
        onSubmit={handleCallSubmit}
      />
    </div>
  )
}

function LeadCard({
  lead, agents, expanded, currentUserId, isSuperAdmin, patientMatch,
  onToggle, onPick, onCall, onAssign, onCompleteFollowUp, onDelete,
}: {
  lead: Lead
  agents: Agent[]
  expanded: boolean
  currentUserId?: string
  isSuperAdmin?: boolean
  patientMatch: { id: string; externalCode: number; fullName: string | null } | null
  onToggle: () => void
  onPick: () => void
  onCall: () => void
  onAssign: (agentId: string | null) => void
  onCompleteFollowUp: (followUpId: string) => void
  onDelete?: () => void
}) {
  const SourceIcon = sourceIcons[lead.source]
  const overdue = isFollowUpOverdue(lead.nextFollowUpAt) && lead.status !== "LOST" && lead.status !== "CONVERTED"
  const pendingFollowUp = lead.followUps.find((f) => f.status === "PENDING")
  const latestAppointment = lead.appointments[0]
  const latestCall = lead.calls[0]
  const isUnassigned = !lead.assignedUserId
  const isPickedByMe = lead.assignedUserId === currentUserId
  const canModify = isSuperAdmin || isPickedByMe

  return (
    <Card className={cn("overflow-hidden transition-shadow", expanded && "shadow-md", overdue && "ring-1 ring-rose-300 dark:ring-rose-800")}>
      <div
        className={cn("transition-colors", canModify && "cursor-pointer hover:bg-muted/30")}
        onClick={canModify ? onToggle : undefined}
      >
        <div className="p-4 flex items-center gap-3">
          <div className={cn("shrink-0 size-10 rounded-xl flex items-center justify-center bg-muted/50")}>
            <SourceIcon className={cn("size-5", sourceColors[lead.source])} />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold">{lead.fullName || "بدون نام"}</span>
              {patientMatch && canModify && (
                <Link href={`/patients/${patientMatch.id}`} target="_blank" onClick={(e) => e.stopPropagation()}>
                  <Badge variant="outline" className="text-[10px] gap-1 text-sky-600 border-sky-300 hover:bg-sky-50 dark:text-sky-400 dark:border-sky-700">
                    <ExternalLink className="size-2.5" />
                    پرونده: {patientMatch.fullName || `کد ${patientMatch.externalCode}`}
                  </Badge>
                </Link>
              )}
              <Badge className={cn("text-[10px] font-normal border-0", statusConfig[lead.status].className)}>
                {statusConfig[lead.status].label}
              </Badge>
              {overdue && (
                <Badge variant="destructive" className="text-[10px] gap-1">
                  <AlertTriangle className="size-2.5" />
                  فالوآپ معوق
                </Badge>
              )}
            </div>
            {canModify && (
            <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground flex-wrap">
              <span dir="ltr">{lead.mobile}</span>
              <span>·</span>
              <span>{sourceLabels[lead.source]}</span>
              {lead.assignedUser && (
                <>
                  <span>·</span>
                  <span className="flex items-center gap-1">
                    <Avatar size="sm" className="size-4">
                      <AvatarFallback className="text-[8px] bg-violet-100 text-violet-700">
                        {getInitials(lead.assignedUser.fullName)}
                      </AvatarFallback>
                    </Avatar>
                    {lead.assignedUser.fullName}
                  </span>
                </>
              )}
            </div>
            )}
            {!canModify && lead.assignedUser && (
              <div className="flex items-center gap-1 mt-0.5 text-xs text-muted-foreground">
                <UserCheck className="size-3" />
                <span>پیگیری شده توسط <strong>{lead.assignedUser.fullName}</strong></span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {latestCall && (
              <div className="hidden sm:flex items-center gap-1 text-xs text-muted-foreground">
                {(() => {
                  const cfg = callStatusConfig[latestCall.callStatus]
                  const Icon = cfg.icon
                  return <Icon className={cn("size-3.5", cfg.color)} />
                })()}
              </div>
            )}
            {lead.nextFollowUpAt && lead.status !== "CONVERTED" && lead.status !== "LOST" && (
              <div className={cn("hidden sm:block text-xs", overdue ? "text-rose-600 font-medium" : "text-muted-foreground")}>
                <Clock className="size-3 inline me-1" />
                {formatDateTime(lead.nextFollowUpAt)}
              </div>
            )}
            {latestAppointment && (
              <Badge variant="outline" className="hidden sm:flex text-[10px] gap-1 text-emerald-700 border-emerald-200">
                <Calendar className="size-2.5" />
                {toPersianNum(latestAppointment.reserveDate)}
              </Badge>
            )}
            {isSuperAdmin && (
              <Button
                size="sm"
                variant="ghost"
                className="h-8 w-8 p-0 text-rose-500 hover:text-rose-700 hover:bg-rose-50"
                title="حذف لید"
                onClick={(e) => { e.stopPropagation(); onDelete?.() }}
              >
                <Trash2 className="size-3.5" />
              </Button>
            )}
            {expanded ? <ChevronUp className="size-4 text-muted-foreground" /> : <ChevronDown className="size-4 text-muted-foreground" />}
          </div>
        </div>

        {/* Full-width action button */}
        <div className="px-4 pb-4">
          {isUnassigned && !isSuperAdmin ? (
            <Button className="w-full h-10 gap-2 text-sm" onClick={(e) => { e.stopPropagation(); onPick() }}>
              <Hand className="size-4" />
              برداشتن لید
            </Button>
          ) : canModify ? (
            <Button className="w-full h-10 gap-2 text-sm" onClick={(e) => { e.stopPropagation(); onCall() }}>
              <PhoneCall className="size-4" />
              تماس
            </Button>
          ) : (
            <Button className="w-full h-10 gap-2 text-sm" variant="outline" disabled title={`توسط ${lead.assignedUser?.fullName || 'دیگری'} برداشته شده`}>
              <UserCheck className="size-4" />
              توسط {lead.assignedUser?.fullName || 'دیگری'}
            </Button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="border-t bg-muted/10 px-4 py-4 space-y-4">

          {/* Patient match banner */}
          {patientMatch && canModify && (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-sky-50 dark:bg-sky-950/20 border border-sky-200 dark:border-sky-900">
              <UserCheck className="size-5 text-sky-600 shrink-0" />
              <div className="flex-1 text-sm">
                <span className="text-sky-700 dark:text-sky-300 font-medium">بیمار قدیمی: </span>
                <span>{patientMatch.fullName || `کد ${patientMatch.externalCode}`}</span>
              </div>
              <Link href={`/patients/${patientMatch.id}`} target="_blank">
                <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
                  <ExternalLink className="size-3" />
                  پروفایل
                </Button>
              </Link>
            </div>
          )}

          {/* Call status summary */}
          {(latestCall || latestAppointment || pendingFollowUp) && (
            <div className="grid gap-2 sm:grid-cols-3">
              {latestCall && (
                <div className="p-3 rounded-lg bg-background border text-sm">
                  <div className="text-xs text-muted-foreground mb-1">آخرین تماس</div>
                  <div className="flex items-center gap-1.5 font-medium">
                    {(() => {
                      const cfg = callStatusConfig[latestCall.callStatus]
                      const Icon = cfg.icon
                      return (
                        <>
                          <Icon className={cn("size-4", cfg.color)} />
                          {cfg.label}
                        </>
                      )
                    })()}
                  </div>
                  {latestCall.callOutcome && (
                    <div className="text-xs text-muted-foreground mt-1">
                      {callOutcomeConfig[latestCall.callOutcome].label}
                      {latestCall.serviceReceived !== null && (
                        <> · خدمت: {latestCall.serviceReceived ? "بله" : "خیر"}</>
                      )}
                    </div>
                  )}
                  <div className="text-[10px] text-muted-foreground mt-1">{formatDateTime(latestCall.createdAt)}</div>
                </div>
              )}
              {latestAppointment && (
                <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900 text-sm">
                  <div className="text-xs text-emerald-600 mb-1">نوبت ثبت‌شده</div>
                  <div className="font-medium text-emerald-700 dark:text-emerald-300">
                    {toPersianNum(latestAppointment.reserveDate)} — {toPersianNum(latestAppointment.reserveTime)}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {latestAppointment.doctorName}
                    {latestAppointment.serviceName && ` · ${latestAppointment.serviceName}`}
                  </div>
                </div>
              )}
              {pendingFollowUp && (
                <div className={cn(
                  "p-3 rounded-lg border text-sm",
                  overdue ? "bg-rose-50 dark:bg-rose-950/20 border-rose-200" : "bg-amber-50 dark:bg-amber-950/20 border-amber-200"
                )}>
                  <div className="text-xs text-muted-foreground mb-1">
                    فالوآپ #{toPersianNum(pendingFollowUp.attemptNumber)}
                  </div>
                  <div className="font-medium">{formatDateTime(pendingFollowUp.scheduledAt)}</div>
                  {pendingFollowUp.reason && (
                    <div className="text-xs text-muted-foreground mt-1">{pendingFollowUp.reason}</div>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 mt-2 text-xs"
                    onClick={() => onCompleteFollowUp(pendingFollowUp.id)}
                  >
                    <CheckCircle2 className="size-3" />
                    انجام شد
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Assign agent */}
          <div className="flex items-center gap-2">
            <Label className="text-xs shrink-0">اپراتور:</Label>
            <Select
              value={lead.assignedUserId ?? "none"}
              onValueChange={(v) => onAssign(v === "none" ? null : v)}
              disabled={!canModify}
            >
              <SelectTrigger className="h-8 text-xs w-44">
                <SelectValue placeholder="تخصیص...">{lead.assignedUser?.fullName || "بدون تخصیص"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">بدون تخصیص</SelectItem>
                {agents.map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.fullName || a.email}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {lead.assignedUser && (
              <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                <span className="text-violet-600">برداشته شده توسط {lead.assignedUser.fullName}</span>
                {!canModify && <span className="text-rose-500">(قفل شده)</span>}
              </span>
            )}
            <div className="text-xs text-muted-foreground flex items-center gap-1 ms-auto">
              <Clock className="size-3" />
              {formatDateTime(lead.createdAt)}
            </div>
          </div>

          {/* Timeline */}
          {(lead.calls.length > 0 || lead.interactions.length > 0) && (
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">تاریخچه</div>
              <div className="space-y-1.5 max-h-40 overflow-y-auto pe-1">
                {[...lead.calls.map((c) => ({
                  id: c.id,
                  type: "CALL" as const,
                  content: `${callStatusConfig[c.callStatus].label}${c.callOutcome ? ` — ${callOutcomeConfig[c.callOutcome].label}` : ""}${c.notes ? `: ${c.notes}` : ""}`,
                  createdAt: c.createdAt,
                })), ...lead.interactions].sort(
                  (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
                ).slice(0, 8).map((item) => (
                  <div key={item.id} className="flex items-start gap-2 p-2 rounded-lg bg-background border text-xs">
                    {item.type === "CALL" ? <PhoneCall className="size-3.5 text-blue-500 shrink-0 mt-0.5" /> :
                     item.type === "NOTE" ? <StickyNote className="size-3.5 text-gray-500 shrink-0 mt-0.5" /> :
                     item.type === "REPORT" ? <FileText className="size-3.5 text-amber-500 shrink-0 mt-0.5" /> :
                     item.type === "ASSIGN" ? <UserPlus className="size-3.5 text-violet-500 shrink-0 mt-0.5" /> :
                     item.type === "MESSAGE" ? <MessageSquare className="size-3.5 text-emerald-500 shrink-0 mt-0.5" /> :
                     <MessageSquare className="size-3.5 text-emerald-500 shrink-0 mt-0.5" />}
                    <div className="flex-1 min-w-0">
                      <div className="text-muted-foreground">{item.content}</div>
                      <div className="text-[10px] text-muted-foreground/70 mt-0.5">{formatDateTime(item.createdAt)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}
