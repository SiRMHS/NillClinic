"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { apiFetch } from "@/lib/api-client"
import { useAuth } from "@/stores/auth.store"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { formatDateTime } from "@/lib/date-utils"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import Link from "next/link"
import {
  Megaphone, Plus, RotateCcw, TrendingUp, Users, CheckCircle2,
  Target, ChevronLeft, Sparkles,
} from "lucide-react"
import {
  type Campaign, type LeadSource, type CampaignStatus,
  sourceLabels, campaignStatusConfig, toPersianNum,
} from "@/components/leads/constants"

export default function CampaignsPage() {
  const { hasPermission } = useAuth()
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // form state
  const [name, setName] = useState("")
  const [slug, setSlug] = useState("")
  const [source, setSource] = useState<LeadSource | "none">("none")
  const [budget, setBudget] = useState("")
  const [notes, setNotes] = useState("")

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiFetch<Campaign[]>("/api/campaigns")
      setCampaigns(data)
    } catch {
      toast.error("خطا در بارگذاری کمپین‌ها")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void fetchData() }, [fetchData])

  const totals = useMemo(() => {
    const totalLeads = campaigns.reduce((s, c) => s + c.leadsCount, 0)
    const totalConverted = campaigns.reduce((s, c) => s + c.convertedCount, 0)
    const rate = totalLeads > 0 ? Math.round((totalConverted / totalLeads) * 1000) / 10 : 0
    const active = campaigns.filter((c) => c.status === "ACTIVE").length
    return { totalLeads, totalConverted, rate, active }
  }, [campaigns])

  const createCampaign = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setSubmitting(true)
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        status: "ACTIVE",
        notes: notes.trim() || undefined,
      }
      if (slug.trim()) body.slug = slug.trim()
      if (source !== "none") body.source = source
      if (budget.trim()) body.budget = Number(budget)
      await apiFetch<Campaign>("/api/campaigns", {
        method: "POST",
        body: JSON.stringify(body),
      })
      toast.success("کمپین ساخته شد")
      setDialogOpen(false)
      setName(""); setSlug(""); setSource("none"); setBudget(""); setNotes("")
      void fetchData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "خطا در ساخت کمپین")
    } finally {
      setSubmitting(false)
    }
  }

  const statCards = [
    { label: "کل کمپین‌ها", value: campaigns.length, sub: `${toPersianNum(totals.active)} فعال`, icon: Megaphone, color: "text-violet-600", bg: "bg-violet-100 dark:bg-violet-950" },
    { label: "کل لیدها", value: totals.totalLeads, sub: "در همه کمپین‌ها", icon: Users, color: "text-blue-600", bg: "bg-blue-100 dark:bg-blue-950" },
    { label: "نوبت‌دار شده", value: totals.totalConverted, sub: "converted", icon: CheckCircle2, color: "text-emerald-600", bg: "bg-emerald-100 dark:bg-emerald-950" },
    { label: "نرخ تبدیل کل", value: `${toPersianNum(totals.rate)}٪`, sub: "میانگین", icon: Target, color: "text-amber-600", bg: "bg-amber-100 dark:bg-amber-950" },
  ]

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Megaphone className="size-6 text-violet-600" />
            <h1 className="text-2xl font-bold tracking-tight">کمپین‌ها</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            مدیریت کمپین‌های ورودی، ردیابی لیدها و نرخ تبدیل هر کمپین
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={fetchData} variant="outline" size="sm">
            <RotateCcw className="size-3.5" />
            بروزرسانی
          </Button>
          {hasPermission("leads") && (
            <Button size="sm" onClick={() => setDialogOpen(true)}>
              <Plus className="size-3.5" />
              کمپین جدید
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
        {statCards.map((s) => (
          <Card key={s.label} className="overflow-hidden">
            <CardContent className="p-3 flex items-center gap-2.5">
              <div className={cn("rounded-lg p-2", s.bg)}>
                <s.icon className={cn("size-4", s.color)} />
              </div>
              <div className="min-w-0">
                <div className="text-xl font-bold leading-none truncate">{s.value}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">{s.label}</div>
                <div className="text-[10px] text-muted-foreground/70">{s.sub}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="ps-4 text-xs uppercase text-muted-foreground">کمپین</TableHead>
              <TableHead className="text-xs uppercase text-muted-foreground">وضعیت</TableHead>
              <TableHead className="text-xs uppercase text-muted-foreground hidden sm:table-cell">منبع</TableHead>
              <TableHead className="text-xs uppercase text-muted-foreground">لیدها</TableHead>
              <TableHead className="text-xs uppercase text-muted-foreground hidden md:table-cell">قیف تبدیل</TableHead>
              <TableHead className="text-xs uppercase text-muted-foreground">نرخ تبدیل</TableHead>
              <TableHead className="text-xs uppercase text-muted-foreground hidden lg:table-cell">ایجاد</TableHead>
              <TableHead className="pe-4 text-xs uppercase text-muted-foreground text-end">عملیات</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={8} className="ps-4"><Skeleton className="h-10 w-full" /></TableCell>
                </TableRow>
              ))
            ) : campaigns.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={8} className="text-center py-16">
                  <div className="flex flex-col items-center gap-2">
                    <div className="size-12 rounded-full bg-muted flex items-center justify-center">
                      <Megaphone className="size-5 text-muted-foreground" />
                    </div>
                    <p className="text-sm text-muted-foreground">هنوز کمپینی ساخته نشده</p>
                    {hasPermission("leads") && (
                      <Button variant="outline" size="sm" className="mt-1" onClick={() => setDialogOpen(true)}>
                        <Plus className="size-3.5" />
                        ساختن اولین کمپین
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              campaigns.map((c) => {
                const rate = c.conversionRate
                const rateColor = rate >= 30 ? "text-emerald-600" : rate >= 15 ? "text-amber-600" : "text-rose-600"
                return (
                  <TableRow key={c.id} className="cursor-pointer group">
                    <TableCell className="ps-4">
                      <Link href={`/campaigns/${c.id}`} className="block min-w-0">
                        <div className="font-medium text-sm truncate group-hover:text-violet-600 transition">
                          {c.name}
                        </div>
                        {c.slug && <div className="text-[11px] text-muted-foreground truncate" dir="ltr">{c.slug}</div>}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge className={cn("text-[10px] font-normal border-0", campaignStatusConfig[c.status].className)}>
                        {campaignStatusConfig[c.status].label}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-xs text-muted-foreground">
                      {c.source ? sourceLabels[c.source] : "—"}
                    </TableCell>
                    <TableCell>
                      <span className="text-sm font-semibold">{toPersianNum(c.leadsCount)}</span>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <div className="flex items-center gap-1.5 text-xs">
                        <span className="inline-flex items-center gap-1 text-blue-600">
                          <Users className="size-3" />
                          {toPersianNum(c.newCount)}
                        </span>
                        <span className="text-muted-foreground/40">←</span>
                        <span className="inline-flex items-center gap-1 text-amber-600">
                          <TrendingUp className="size-3" />
                          {toPersianNum(c.contactedCount)}
                        </span>
                        <span className="text-muted-foreground/40">←</span>
                        <span className="inline-flex items-center gap-1 text-emerald-600">
                          <CheckCircle2 className="size-3" />
                          {toPersianNum(c.convertedCount)}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className={cn("text-sm font-bold", rateColor)}>{toPersianNum(rate)}٪</span>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                      {formatDateTime(c.createdAt)}
                    </TableCell>
                    <TableCell className="pe-4 text-end">
                      <Link href={`/campaigns/${c.id}`}>
                        <Button variant="ghost" size="icon-sm" className="text-muted-foreground group-hover:text-foreground">
                          <ChevronLeft className="size-4" />
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md" showCloseButton>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="size-4 text-violet-600" />
              کمپین جدید
            </DialogTitle>
            <DialogDescription>
              لیدهای وب‌هوک با <code className="text-xs">campaign_id</code> یا <code className="text-xs">campaign_slug</code> به‌صورت خودکار به این کمپین متصل می‌شوند.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={createCampaign} className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="cname">نام کمپین</Label>
              <Input id="cname" required placeholder="مثلاً: آکیشن تابستانه اینستاگرام" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cslug">اسلاگ (اختیاری)</Label>
              <Input id="cslug" dir="ltr" placeholder="summer-ig-1403" value={slug} onChange={(e) => setSlug(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="csource">منبع</Label>
                <Select value={source} onValueChange={(v) => setSource(v as LeadSource | "none")}>
                  <SelectTrigger id="csource"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">همه</SelectItem>
                    {Object.entries(sourceLabels).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cbudget">بودجه (اختیاری)</Label>
                <Input id="cbudget" type="number" min={0} placeholder="0" value={budget} onChange={(e) => setBudget(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cnotes">یادداشت (اختیاری)</Label>
              <Input id="cnotes" placeholder="توضیحات کمپین..." value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>انصراف</Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? "در حال ساخت..." : "ساخت کمپین"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}