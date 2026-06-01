"use client"

import { useEffect, useState, useCallback } from "react"
import { apiFetch } from "@/lib/api-client"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  RefreshCwIcon, SearchIcon, WebhookIcon, CheckCircle2Icon,
  XCircleIcon, AlertTriangleIcon, CopyIcon,
} from "lucide-react"
import { toast } from "sonner"

interface WebhookLog {
  id: string
  source: string
  action: string
  name: string | null
  phone: string | null
  externalRef: string | null
  ipAddress: string | null
  metadata: Record<string, unknown>
  errorMsg: string | null
  createdAt: string
}

interface WebhookLogsResponse {
  logs: WebhookLog[]
  total: number
  limit: number
  offset: number
}

function toPersianNum(num: number | string) {
  return num.toString().replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[parseInt(d, 10)]!)
}

const actionConfig: Record<string, { label: string; color: string }> = {
  created: { label: "ایجاد شد", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300" },
  duplicate: { label: "تکراری", color: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300" },
  rejected: { label: "رد شد", color: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300" },
  received: { label: "دریافت شد", color: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" },
}

const sourceLabels: Record<string, string> = {
  instagram: "اینستاگرام",
  whatsapp: "واتساپ",
  site: "سایت",
}

export default function WebhookLogsPage() {
  const [data, setData] = useState<WebhookLogsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [sourceFilter, setSourceFilter] = useState<string>("all")
  const [actionFilter, setActionFilter] = useState<string>("all")

  const loadLogs = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (sourceFilter !== "all") params.set("source", sourceFilter)
      if (actionFilter !== "all") params.set("action", actionFilter)
      params.set("limit", "200")
      const res = await apiFetch<WebhookLogsResponse>(`/api/webhook-logs?${params}`)
      setData(res)
    } catch { toast.error("خطا در بارگذاری لاگ‌ها") }
    finally { setLoading(false) }
  }, [sourceFilter, actionFilter])

  useEffect(() => { loadLogs() }, [loadLogs])

  const filtered = data?.logs.filter((l) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      l.name?.toLowerCase().includes(q) ||
      l.phone?.includes(q) ||
      l.externalRef?.toLowerCase().includes(q) ||
      l.source.toLowerCase().includes(q)
    )
  }) ?? []

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">لاگ وب‌هوک</h1>
          <p className="text-sm text-muted-foreground mt-1">
            ثبت درخواست‌های دریافتی از وب‌هوک (Manychat / n8n)
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={loadLogs} className="gap-2">
          <RefreshCwIcon className="size-4" />
          بروزرسانی
        </Button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative w-full max-w-sm">
          <SearchIcon className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="جستجو در نام، تلفن، منبع..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pr-9"
          />
        </div>
        <Select value={sourceFilter} onValueChange={(v: string | null) => v && setSourceFilter(v)}>
          <SelectTrigger className="w-32">
            <SelectValue placeholder="منبع" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">همه منابع</SelectItem>
            <SelectItem value="instagram">اینستاگرام</SelectItem>
            <SelectItem value="whatsapp">واتساپ</SelectItem>
            <SelectItem value="site">سایت</SelectItem>
          </SelectContent>
        </Select>
        <Select value={actionFilter} onValueChange={(v: string | null) => v && setActionFilter(v)}>
          <SelectTrigger className="w-32">
            <SelectValue placeholder="وضعیت" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">همه وضعیت‌ها</SelectItem>
            <SelectItem value="created">ایجاد شد</SelectItem>
            <SelectItem value="duplicate">تکراری</SelectItem>
            <SelectItem value="rejected">رد شد</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <WebhookIcon className="size-4" />
            درخواست‌های وب‌هوک
            {data && (
              <span className="text-sm font-normal text-muted-foreground">
                (مجموع: {toPersianNum(data.total)})
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4 space-y-3">
              {[1,2,3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>منبع</TableHead>
                  <TableHead>وضعیت</TableHead>
                  <TableHead>نام</TableHead>
                  <TableHead>تلفن</TableHead>
                  <TableHead>شناسه خارجی</TableHead>
                  <TableHead>IP</TableHead>
                  <TableHead>زمان</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                      هیچ لاگی یافت نشد
                    </TableCell>
                  </TableRow>
                ) : filtered.map((log) => {
                  const cfg = actionConfig[log.action] || { label: log.action, color: "bg-muted" }
                  return (
                    <TableRow key={log.id} className="text-sm">
                      <TableCell>
                        <Badge variant="outline">
                          {sourceLabels[log.source] || log.source}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className={`gap-1 ${cfg.color}`}>
                          {log.action === "created" ? <CheckCircle2Icon className="size-3" /> :
                           log.action === "duplicate" ? <CopyIcon className="size-3" /> :
                           <AlertTriangleIcon className="size-3" />}
                          {cfg.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[120px] truncate">{log.name || "—"}</TableCell>
                      <TableCell dir="ltr">{log.phone || "—"}</TableCell>
                      <TableCell className="max-w-[100px] truncate" dir="ltr">{log.externalRef || "—"}</TableCell>
                      <TableCell className="text-muted-foreground" dir="ltr">{log.ipAddress || "—"}</TableCell>
                      <TableCell className="text-muted-foreground whitespace-nowrap">
                        {new Date(log.createdAt).toLocaleString("fa-IR")}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
