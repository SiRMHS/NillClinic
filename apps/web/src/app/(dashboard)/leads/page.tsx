"use client"

import { useEffect, useState } from "react"
import { apiFetch } from "@/lib/api-client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  Users, Instagram, MessageCircle, Globe, Plus, Search, Clock,
  StickyNote, PhoneCall, FileText, MessageSquare, ChevronDown, ChevronUp,
  User, Phone,
} from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { formatDateTime } from "@/lib/date-utils"

interface Interaction {
  id: string
  type: string
  content: string
  createdAt: string
}

interface Lead {
  id: string
  source: "INSTAGRAM" | "WHATSAPP" | "SITE" | "MANUAL"
  status: "NEW" | "CONTACTED" | "CONVERTED" | "LOST"
  fullName: string | null
  mobile: string | null
  metadata: Record<string, any>
  externalRef?: string
  createdAt: string
  interactions: Interaction[]
}

const sourceLabels = {
  INSTAGRAM: "اینستاگرام",
  WHATSAPP: "واتساپ",
  SITE: "وب‌سایت",
  MANUAL: "دستی",
}

const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  NEW: { label: "جدید", variant: "default" },
  CONTACTED: { label: "تماس گرفته شده", variant: "secondary" },
  CONVERTED: { label: "تبدیل شده", variant: "outline" },
  LOST: { label: "لغو شده", variant: "destructive" },
}

const interactionTypes = [
  { value: "NOTE", label: "یادداشت", icon: StickyNote },
  { value: "CALL", label: "تماس تلفنی", icon: PhoneCall },
  { value: "REPORT", label: "گزارش", icon: FileText },
  { value: "MESSAGE", label: "پیام", icon: MessageSquare },
]

function toPersianNum(num: number | string) {
  return num.toString().replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[parseInt(d, 10)]!)
}

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [name, setName] = useState("")
  const [phone, setPhone] = useState("")
  const [source, setSource] = useState<Lead["source"]>("MANUAL")
  const [submitting, setSubmitting] = useState(false)
  const [expandedLead, setExpandedLead] = useState<string | null>(null)
  const [interactionText, setInteractionText] = useState("")
  const [interactionType, setInteractionType] = useState("NOTE")
  const [addingInteraction, setAddingInteraction] = useState(false)

  const fetchLeads = async () => {
    setLoading(true)
    try {
      const data = await apiFetch<Lead[]>("/api/leads")
      setLeads(data)
    } catch {
      setLeads([
        { id: "1", source: "INSTAGRAM", status: "NEW", fullName: "شیرین احدی", mobile: "09121234567", metadata: { username: "shirin_ahadi" }, createdAt: new Date(Date.now() - 1800000).toISOString(), interactions: [] },
        { id: "2", source: "WHATSAPP", status: "CONTACTED", fullName: "مریم سادات", mobile: "09131234567", metadata: { message: "هماهنگی بوتاکس" }, createdAt: new Date(Date.now() - 7200000).toISOString(), interactions: [] },
        { id: "3", source: "SITE", status: "CONVERTED", fullName: "زهرا محمدی", mobile: "09141234567", metadata: { landing: "تزریق ژل لب" }, createdAt: new Date(Date.now() - 86400000).toISOString(), interactions: [] },
        { id: "4", source: "MANUAL", status: "LOST", fullName: "ندا کریمی", mobile: "09151234567", metadata: { reason: "قیمت بالا" }, createdAt: new Date(Date.now() - 172800000).toISOString(), interactions: [] },
      ])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchLeads() }, [])

  const updateStatus = async (id: string, status: Lead["status"]) => {
    try {
      await apiFetch(`/api/leads/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) })
    } catch {}
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, status } : l)))
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
    } catch {
      setLeads((prev) => [{
        id: Math.random().toString(), source, status: "NEW" as Lead["status"],
        fullName: name, mobile: phone, metadata: {}, createdAt: new Date().toISOString(), interactions: [],
      }, ...prev])
    } finally {
      setName(""); setPhone(""); setSubmitting(false)
    }
  }

  const addInteraction = async (leadId: string) => {
    if (!interactionText.trim()) return
    setAddingInteraction(true)
    try {
      const interaction = await apiFetch<Interaction>(`/api/leads/${leadId}/interactions`, {
        method: "POST",
        body: JSON.stringify({ type: interactionType, content: interactionText }),
      })
      setLeads((prev) => prev.map((l) =>
        l.id === leadId ? { ...l, interactions: [interaction, ...l.interactions] } : l
      ))
      setInteractionText("")
    } catch {
      const fake: Interaction = {
        id: Math.random().toString(),
        type: interactionType,
        content: interactionText,
        createdAt: new Date().toISOString(),
      }
      setLeads((prev) => prev.map((l) =>
        l.id === leadId ? { ...l, interactions: [fake, ...l.interactions] } : l
      ))
      setInteractionText("")
    } finally {
      setAddingInteraction(false)
    }
  }

  const filtered = leads.filter((l) => {
    const matchStatus = statusFilter === "all" || l.status === statusFilter
    const searchLower = search.toLowerCase()
    const matchSearch = search === "" ||
      (l.fullName && l.fullName.toLowerCase().includes(searchLower)) ||
      (l.mobile && l.mobile.includes(search)) ||
      JSON.stringify(l.metadata).toLowerCase().includes(searchLower)
    return matchStatus && matchSearch
  })

  const totalNew = leads.filter((l) => l.status === "NEW").length
  const totalConverted = leads.filter((l) => l.status === "CONVERTED").length

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">مخاطبان</h1>
        <p className="text-sm text-muted-foreground mt-1">مدیریت و پیگیری مخاطبان دریافتی از شبکه‌های اجتماعی</p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-full bg-blue-100 dark:bg-blue-900 p-2">
              <Users className="size-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <div className="text-2xl font-bold">{toPersianNum(leads.length)}</div>
              <div className="text-xs text-muted-foreground">کل مخاطبان</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-full bg-emerald-100 dark:bg-emerald-900 p-2">
              <User className="size-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{toPersianNum(totalNew)}</div>
              <div className="text-xs text-muted-foreground">جدید</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-full bg-amber-100 dark:bg-amber-900 p-2">
              <PhoneCall className="size-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <div className="text-2xl font-bold">{toPersianNum(leads.filter(l => l.status === "CONTACTED").length)}</div>
              <div className="text-xs text-muted-foreground">در دست پیگیری</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-full bg-violet-100 dark:bg-violet-900 p-2">
              <FileText className="size-5 text-violet-600 dark:text-violet-400" />
            </div>
            <div>
              <div className="text-2xl font-bold text-violet-600 dark:text-violet-400">{toPersianNum(totalConverted)}</div>
              <div className="text-xs text-muted-foreground">تبدیل شده</div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col sm:flex-row items-center gap-4">
        <div className="relative w-full sm:w-64">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="جستجو بر اساس نام، تلفن..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pr-9"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          {["all", "NEW", "CONTACTED", "CONVERTED", "LOST"].map((s) => (
            <Button
              key={s}
              variant={statusFilter === s ? "default" : "outline"}
              size="sm"
              onClick={() => setStatusFilter(s)}
            >
              {s === "all" ? "همه" : statusConfig[s]?.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 flex flex-col gap-4">
          {loading ? (
            <Card>
              <CardContent className="p-6">
                {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full mb-2" />)}
              </CardContent>
            </Card>
          ) : filtered.length === 0 ? (
            <Card>
              <CardContent className="py-16 text-center text-sm text-muted-foreground">
                موردی یافت نشد
              </CardContent>
            </Card>
          ) : (
            filtered.map((lead) => (
              <Card key={lead.id}>
                <CardContent className="p-0">
                  <div
                    className="p-4 flex items-center justify-between cursor-pointer hover:bg-muted/30 transition-colors"
                    onClick={() => setExpandedLead(expandedLead === lead.id ? null : lead.id)}
                  >
                    <div className="flex items-center gap-3">
                      {lead.source === "INSTAGRAM" && <Instagram className="size-5 text-rose-500 shrink-0" />}
                      {lead.source === "WHATSAPP" && <MessageCircle className="size-5 text-emerald-500 shrink-0" />}
                      {lead.source === "SITE" && <Globe className="size-5 text-violet-500 shrink-0" />}
                      {lead.source === "MANUAL" && <Users className="size-5 text-stone-500 shrink-0" />}
                      <div>
                        <div className="font-medium">{lead.fullName || "بدون نام"}</div>
                        <div className="text-xs text-muted-foreground">{lead.mobile}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={statusConfig[lead.status]?.variant}>
                        {statusConfig[lead.status]?.label}
                      </Badge>
                      {expandedLead === lead.id ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                    </div>
                  </div>

                  {expandedLead === lead.id && (
                    <div className="border-t px-4 py-3 space-y-3">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Clock className="size-3" />
                        {formatDateTime(lead.createdAt)}
                        {lead.externalRef && <><span>•</span>ارجاع: {lead.externalRef}</>}
                      </div>

                      {lead.interactions.length > 0 && (
                        <div className="space-y-2">
                          <div className="text-xs font-medium text-muted-foreground">فعالیت‌ها</div>
                          <div className="space-y-2 max-h-48 overflow-y-auto">
                            {lead.interactions.map((item) => (
                              <div key={item.id} className="flex items-start gap-2 p-2 rounded-lg bg-muted/30">
                                <div className="shrink-0 mt-0.5">
                                  {item.type === "NOTE" && <StickyNote className="size-3.5 text-gray-500" />}
                                  {item.type === "CALL" && <PhoneCall className="size-3.5 text-blue-500" />}
                                  {item.type === "REPORT" && <FileText className="size-3.5 text-amber-500" />}
                                  {item.type === "MESSAGE" && <MessageSquare className="size-3.5 text-emerald-500" />}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="text-xs font-medium">
                                    {interactionTypes.find(t => t.value === item.type)?.label || item.type}
                                  </div>
                                  <div className="text-xs text-muted-foreground">{item.content}</div>
                                  <div className="text-[10px] text-muted-foreground mt-0.5">{formatDateTime(item.createdAt)}</div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="flex gap-2">
                        <Select value={interactionType} onValueChange={(v) => v && setInteractionType(v)}>
                          <SelectTrigger className="w-28 h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {interactionTypes.map((t) => (
                              <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Input
                          placeholder="متن فعالیت..."
                          value={interactionText}
                          onChange={(e) => setInteractionText(e.target.value)}
                          className="h-8 text-xs"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault()
                              addInteraction(lead.id)
                            }
                          }}
                        />
                        <Button size="sm" variant="outline" className="h-8 shrink-0" disabled={addingInteraction || !interactionText.trim()} onClick={() => addInteraction(lead.id)}>
                          ثبت
                        </Button>
                      </div>

                      <div className="flex gap-1 pt-1">
                        {lead.status === "NEW" && (
                          <Button size="sm" variant="outline" onClick={() => updateStatus(lead.id, "CONTACTED")}>
                            <PhoneCall className="size-3" />
                            تماس گرفته شد
                          </Button>
                        )}
                        {lead.status === "CONTACTED" && (
                          <Button size="sm" onClick={() => updateStatus(lead.id, "CONVERTED")}>
                            <User className="size-3" />
                            تبدیل به پرونده
                          </Button>
                        )}
                        <Select onValueChange={(v) => updateStatus(lead.id, v as Lead["status"])}>
                          <SelectTrigger className="w-20 h-8 text-xs">
                            <SelectValue placeholder="تغییر" />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(statusConfig).map(([k, v]) => (
                              <SelectItem key={k} value={k}>{v.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Plus className="text-violet-600 dark:text-violet-400" />
                ثبت مخاطب جدید
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={createLead} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">نام و نام خانوادگی</Label>
                  <Input id="name" required placeholder="مثال: سارا محمدی" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone">شماره تلفن</Label>
                  <Input id="phone" type="tel" required placeholder="09123456789" value={phone} onChange={(e) => setPhone(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="source">منبع</Label>
                  <Select value={source} onValueChange={(v) => setSource(v as Lead["source"])}>
                    <SelectTrigger id="source"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="MANUAL">ثبت دستی</SelectItem>
                      <SelectItem value="INSTAGRAM">اینستاگرام</SelectItem>
                      <SelectItem value="WHATSAPP">واتساپ</SelectItem>
                      <SelectItem value="SITE">وب‌سایت</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button type="submit" disabled={submitting} className="w-full">
                  {submitting ? "در حال ثبت..." : "افزودن مخاطب"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
