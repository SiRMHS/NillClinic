"use client"

import { useEffect, useState, useCallback, startTransition } from "react"
import { apiFetch } from "@/lib/api-client"
import { useAuth } from "@/stores/auth.store"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible"
import {
  RefreshCw,
  Database,
  History,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Settings2,
  Play,
  Square,
  ChevronDown,
  ChevronUp,
  Filter,
  Loader2,
  Bug,
} from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

type SyncEntity = "PATIENTS" | "SERVICES" | "RESERVES" | "TREATMENTS" | "RECEPTIONS"
type SyncStatus = "STARTED" | "SUCCESS" | "PARTIAL" | "FAILED"
type SyncTrigger = "CRON" | "MANUAL"

interface SyncLog {
  id: string
  entity: SyncEntity
  status: SyncStatus
  trigger: SyncTrigger
  recordsRead: number
  recordsUpserted: number
  recordsFailed: number
  errorMessage?: string
  metadata?: { pagesProcessed?: number; errors?: { recordId: string; message: string }[] }
  startedAt: string
  finishedAt?: string
}

interface ErrorPage {
  items: { recordId: string; message: string }[]
  total: number
  page: number
  totalPages: number
  limit: number
}

const ALL_ENTITIES: SyncEntity[] = ["PATIENTS", "SERVICES", "RESERVES", "TREATMENTS", "RECEPTIONS"]

const entityLabels: Record<SyncEntity, string> = {
  PATIENTS: "بیماران",
  SERVICES: "خدمات",
  RESERVES: "رزروها",
  TREATMENTS: "طرح‌های درمانی",
  RECEPTIONS: "پذیرش / نوبت‌ها",
}

const entityColors: Record<SyncEntity, string> = {
  PATIENTS: "text-sky-600 dark:text-sky-400",
  SERVICES: "text-emerald-600 dark:text-emerald-400",
  RESERVES: "text-amber-600 dark:text-amber-400",
  TREATMENTS: "text-violet-600 dark:text-violet-400",
  RECEPTIONS: "text-rose-600 dark:text-rose-400",
}

const statusConfig: Record<SyncStatus, { label: string; variant: "default" | "secondary" | "outline" | "destructive"; icon: typeof RefreshCw }> = {
  STARTED: { label: "در حال اجرا", variant: "secondary", icon: RefreshCw },
  SUCCESS: { label: "موفق", variant: "default", icon: CheckCircle2 },
  PARTIAL: { label: "ناقص", variant: "outline", icon: AlertTriangle },
  FAILED: { label: "ناموفق", variant: "destructive", icon: XCircle },
}

function toPersianNum(num: number | string) {
  return num.toString().replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[parseInt(d, 10)]!)
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString("fa-IR", {
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit",
    })
  } catch { return iso }
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "همین لحظه"
  if (mins < 60) return `${mins} دقیقه پیش`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} ساعت پیش`
  return `${Math.floor(hours / 24)} روز پیش`
}

interface SyncRunStatus {
  isRunning: boolean
  runningEntities: SyncEntity[]
  hasActiveController?: boolean
}

export default function SyncPage() {
  const { user, hasPermission } = useAuth()
  const [logs, setLogs] = useState<SyncLog[]>([])
  const [loading, setLoading] = useState(true)
  const [syncStatus, setSyncStatus] = useState<SyncRunStatus>({ isRunning: false, runningEntities: [] })
  const [showErrors, setShowErrors] = useState<Set<string>>(new Set())
  const [showConfig, setShowConfig] = useState(false)
  const [filterEntity, setFilterEntity] = useState<SyncEntity | "ALL">("ALL")
  const [cancelling, setCancelling] = useState(false)
  const [purging, setPurging] = useState(false)
  const [startingSync, setStartingSync] = useState(false)

  const [maxPages, setMaxPages] = useState(2)
  const [pageSize, setPageSize] = useState(50)
  const [selectedEntities, setSelectedEntities] = useState<Set<SyncEntity>>(new Set(ALL_ENTITIES))

  const [errorDetails, setErrorDetails] = useState<Record<string, ErrorPage>>({})
  const [loadingErrors, setLoadingErrors] = useState<Set<string>>(new Set())

  const runningEntities = new Set(syncStatus.runningEntities)
  const isSyncing = syncStatus.isRunning
  const isSuperAdmin = hasPermission("*")

  const fetchLogs = useCallback(async () => {
    const params = filterEntity !== "ALL" ? `?entity=${filterEntity}` : ""
    return apiFetch<SyncLog[]>(`/api/sync/logs${params}`)
  }, [filterEntity])

  const fetchStatus = useCallback(async () => {
    return apiFetch<SyncRunStatus>("/api/sync/status")
  }, [])

  const refresh = useCallback(async () => {
    try {
      const [status, data] = await Promise.all([fetchStatus(), fetchLogs()])
      startTransition(() => {
        setSyncStatus(status)
        setLogs(data)
        setLoading(false)
      })
    } catch {
      startTransition(() => setLoading(false))
    }
  }, [fetchStatus, fetchLogs])

  useEffect(() => {
    void refresh()
    const id = setInterval(() => { void refresh() }, 2000)
    return () => clearInterval(id)
  }, [refresh])

  const purgeData = async () => {
    if (!confirm("تمام داده‌های CRM (بیماران، خدمات، رزرو، طرح درمان، پذیرش) پاک می‌شوند. ادامه می‌دهید؟")) {
      return
    }
    setPurging(true)
    try {
      const purgeRes = await apiFetch<{ ok: boolean; counts: Record<string, number> }>(
        "/api/sync/purge",
        { method: "POST" },
      )
      const total = Object.values(purgeRes.counts).reduce((a, b) => a + b, 0)
      toast.success(`پاکسازی انجام شد — ${total} رکورد حذف شد`)
    } catch {
      toast.error("خطا در پاکسازی داده‌ها")
    } finally {
      setPurging(false)
    }
  }

  const runSync = async (entities?: SyncEntity[]) => {
    const targetEntities = entities ?? Array.from(selectedEntities)
    setStartingSync(true)

    try {
      const params = new URLSearchParams()
      params.set("maxPages", String(maxPages))
      params.set("pageSize", String(pageSize))

      await apiFetch<{ ok: boolean; started: boolean }>(
        `/api/sync/run?${params}`,
        { method: "POST", body: JSON.stringify({ entities: targetEntities }) },
      )

      const names = targetEntities.map((e) => entityLabels[e]).join("، ")
      toast.success(`سینک ${names} شروع شد`)
      await refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "خطا در شروع سینک")
    } finally {
      setStartingSync(false)
    }
  }

  const cancelSync = async () => {
    setCancelling(true)
    try {
      await apiFetch<{ ok: boolean; finalized: number }>("/api/sync/cancel", { method: "POST" })
      toast.success("سینک متوقف شد")
      await refresh()
    } catch {
      toast.error("خطا در توقف سینک")
    } finally {
      setCancelling(false)
    }
  }

  const fetchErrorDetails = useCallback(async (logId: string, pageNum = 1) => {
    setLoadingErrors((prev) => new Set(prev).add(logId))
    try {
      const data = await apiFetch<ErrorPage>(`/api/sync/logs/${logId}/errors?page=${pageNum}&limit=20`)
      setErrorDetails((prev) => ({ ...prev, [logId]: data }))
    } catch {
      toast.error("خطا در دریافت جزئیات خطاها")
    } finally {
      setLoadingErrors((prev) => {
        const next = new Set(prev)
        next.delete(logId)
        return next
      })
    }
  }, [])

  const viewErrorDetail = async (logId: string) => {
    setShowErrors((prev) => {
      const next = new Set(prev)
      if (next.has(logId)) {
        next.delete(logId)
      } else {
        next.add(logId)
        if (!errorDetails[logId]) {
          void fetchErrorDetails(logId)
        }
      }
      return next
    })
  }

  const toggleEntity = (entity: SyncEntity) => {
    setSelectedEntities((prev) => {
      const next = new Set(prev)
      if (next.has(entity)) next.delete(entity)
      else next.add(entity)
      return next
    })
  }

  const toggleError = (id: string) => {
    setShowErrors((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const lastStatusPerEntity = ALL_ENTITIES.map((entity) => {
    const last = logs.find((l) => l.entity === entity)
    return { entity, last }
  })

  const runningLogs = logs.filter((l) => l.status === "STARTED")

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">سینک CRM</h1>
          <p className="text-sm text-muted-foreground mt-1">
            هماهنگ‌سازی داده‌های کلینیک با سرور جردن
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={() => setShowConfig(!showConfig)}>
            <Settings2 className={showConfig ? "rotate-45" : ""} />
            تنظیمات
          </Button>
          <Button
            variant="outline"
            onClick={purgeData}
            disabled={purging || isSyncing}
            className="text-rose-600 border-rose-200 hover:bg-rose-50"
          >
            <Database />
            {purging ? "در حال پاکسازی..." : "پاکسازی داده‌های CRM"}
          </Button>
          {isSyncing ? (
            <Button variant="destructive" onClick={cancelSync} disabled={cancelling} size="lg">
              <Square />
              {cancelling ? "در حال توقف..." : "توقف سینک"}
            </Button>
          ) : (
            <Button onClick={() => runSync()} disabled={startingSync || selectedEntities.size === 0} size="lg">
              {startingSync ? <Loader2 className="animate-spin" /> : <Play />}
              اجرای سینک
            </Button>
          )}
        </div>
      </div>

      {showConfig && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Settings2 />
              تنظیمات سینک
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-2">
                <Label>تعداد صفحات</Label>
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={maxPages}
                  onChange={(e) => setMaxPages(Number(e.target.value) || 1)}
                />
                <p className="text-xs text-muted-foreground">تعداد صفحاتی که از هر بخش دریافت شود</p>
              </div>
              <div className="space-y-2">
                <Label>تعداد رکورد در هر صفحه</Label>
                <Input
                  type="number"
                  min={1}
                  max={200}
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value) || 50)}
                />
                <p className="text-xs text-muted-foreground">حداکثر رکورد در هر درخواست</p>
              </div>
              <div className="space-y-2">
                <Label>بخش‌های مورد نظر</Label>
                <div className="flex flex-wrap gap-2 mt-1">
                  {ALL_ENTITIES.map((entity) => (
                    <Badge
                      key={entity}
                      variant={selectedEntities.has(entity) ? "default" : "outline"}
                      className="cursor-pointer select-none"
                      onClick={() => toggleEntity(entity)}
                    >
                      {entityLabels[entity]}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Progress indicator when syncing */}
      {isSyncing && (
        <Card className="border-primary/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Loader2 className="size-4 animate-spin" />
              در حال هماهنگ‌سازی...
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {syncStatus.runningEntities.map((entity) => {
              const lastRunningLog = runningLogs.find((l) => l.entity === entity)
              const pages = lastRunningLog?.metadata?.pagesProcessed ?? 0
              const pct = maxPages > 0 ? Math.min(Math.round((pages / maxPages) * 100), 99) : 0
              const label = entityLabels[entity]
              return (
                <div key={entity} className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <RefreshCw className={cn("size-3.5 animate-spin", entityColors[entity])} />
                      <span className="font-medium">{label}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      صفحه {toPersianNum(pages)} از {toPersianNum(maxPages)}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  {lastRunningLog && (
                    <div className="text-[10px] text-muted-foreground flex gap-3">
                      <span>خوانده: {toPersianNum(lastRunningLog.recordsRead)}</span>
                      <span>به‌روز: {toPersianNum(lastRunningLog.recordsUpserted)}</span>
                      {lastRunningLog.recordsFailed > 0 && (
                        <span className="text-destructive">خطا: {toPersianNum(lastRunningLog.recordsFailed)}</span>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {lastStatusPerEntity.map(({ entity, last }) => {
          const syncing = runningEntities.has(entity)
          const runningLog = runningLogs.find((l) => l.entity === entity)
          return (
            <Card
              key={entity}
              className={cn(
                "relative",
                last?.status === "FAILED" && "border-destructive/50",
                syncing && "border-primary/50",
              )}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <Database className={cn("size-5", entityColors[entity])} />
                    <div>
                      <div className="text-sm font-medium">{entityLabels[entity]}</div>
                      {last ? (
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          {timeAgo(last.startedAt)}
                        </div>
                      ) : (
                        <div className="text-[10px] text-muted-foreground mt-0.5">هنوز سینک نشده</div>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {last && !syncing && (
                      <Badge variant={statusConfig[last.status].variant} className="text-[10px]">
                        {statusConfig[last.status].label}
                      </Badge>
                    )}
                    {syncing && (
                      <Badge variant="secondary" className="text-[10px] gap-1">
                        <Loader2 className="size-3 animate-spin" />
                        در حال اجرا
                      </Badge>
                    )}
                    {last?.metadata?.pagesProcessed && !syncing && (
                      <span className="text-[10px] text-muted-foreground">
                        {toPersianNum(last.metadata.pagesProcessed)} صفحه
                      </span>
                    )}
                  </div>
                </div>

                {/* Progress bar for syncing entity */}
                {syncing && (
                  <div className="mt-3">
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary animate-pulse"
                        style={{
                          width: `${runningLog?.metadata?.pagesProcessed
                            ? Math.min(Math.round((runningLog.metadata.pagesProcessed / maxPages) * 100), 99)
                            : 5}%`
                        }}
                      />
                    </div>
                    {runningLog && (
                      <div className="mt-2 grid grid-cols-3 gap-2 text-center text-[10px]">
                        <div>
                          <div className="font-semibold">{toPersianNum(runningLog.recordsRead)}</div>
                          <div className="text-muted-foreground">خوانده</div>
                        </div>
                        <div>
                          <div className="font-semibold text-emerald-600 dark:text-emerald-400">
                            {toPersianNum(runningLog.recordsUpserted)}
                          </div>
                          <div className="text-muted-foreground">به‌روز</div>
                        </div>
                        <div>
                          <div className={cn("font-semibold", runningLog.recordsFailed > 0 ? "text-destructive" : "")}>
                            {toPersianNum(runningLog.recordsFailed)}
                          </div>
                          <div className="text-muted-foreground">خطا</div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {last && !syncing && (
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                    <div>
                      <div className="font-semibold">{toPersianNum(last.recordsRead)}</div>
                      <div className="text-muted-foreground">خوانده</div>
                    </div>
                    <div>
                      <div className="font-semibold text-emerald-600 dark:text-emerald-400">
                        {toPersianNum(last.recordsUpserted)}
                      </div>
                      <div className="text-muted-foreground">به‌روز</div>
                    </div>
                    <div>
                      <div className={cn("font-semibold", last.recordsFailed > 0 ? "text-destructive" : "")}>
                        {toPersianNum(last.recordsFailed)}
                      </div>
                      <div className="text-muted-foreground">خطا</div>
                    </div>
                  </div>
                )}

                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2 w-full text-xs"
                  disabled={syncing}
                  onClick={() => runSync([entity])}
                >
                  <Play className="size-3 ml-1" />
                  سینک {entityLabels[entity]}
                </Button>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <History />
            تاریخچه سینک‌ها
          </CardTitle>
          <div className="flex items-center gap-2">
            <Filter className="size-4 text-muted-foreground" />
            <select
              className="text-sm bg-background border rounded-md px-2 py-1"
              value={filterEntity}
              onChange={(e) => setFilterEntity(e.target.value as SyncEntity | "ALL")}
            >
              <option value="ALL">همه</option>
              {ALL_ENTITIES.map((e) => (
                <option key={e} value={e}>{entityLabels[e]}</option>
              ))}
            </select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>موجودیت</TableHead>
                <TableHead>نوع</TableHead>
                <TableHead>وضعیت</TableHead>
                <TableHead>صفحات</TableHead>
                <TableHead>خوانده</TableHead>
                <TableHead>به‌روز</TableHead>
                <TableHead>خطا</TableHead>
                <TableHead>تاریخ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={8}>
                    <div className="flex flex-col gap-2 p-4">
                      {[1, 2, 3].map((i) => <Skeleton key={i} className="h-8 w-full" />)}
                    </div>
                  </TableCell>
                </TableRow>
              ) : logs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                    هیچ لاگی یافت نشد
                  </TableCell>
                </TableRow>
              ) : (
                logs.map((log) => {
                  const StatusIcon = statusConfig[log.status].icon
                  const hasError = log.errorMessage || log.recordsFailed > 0
                  const isExpanded = showErrors.has(log.id)
                  const errorsMeta = log.metadata?.errors
                  const pageData = errorDetails[log.id]
                  return (
                    <TableRow key={log.id} className="group">
                      <TableCell colSpan={8} className="p-0">
                        <Collapsible open={isExpanded}>
                          <CollapsibleTrigger className="flex items-center p-4 w-full cursor-pointer" onClick={() => {
                            if (!isExpanded && hasError && isSuperAdmin && errorsMeta?.length && !errorDetails[log.id]) {
                              void fetchErrorDetails(log.id)
                            }
                            setShowErrors((prev) => {
                              const next = new Set(prev)
                              if (next.has(log.id)) next.delete(log.id)
                              else next.add(log.id)
                              return next
                            })
                          }}>
                            <div className="flex-1 grid grid-cols-[1.5fr_0.8fr_0.8fr_0.6fr_0.6fr_0.6fr_0.6fr_1.2fr] gap-2 items-center text-sm">
                              <div className="font-medium flex items-center gap-2">
                                <Database className={cn("size-4", entityColors[log.entity])} />
                                {entityLabels[log.entity]}
                              </div>
                              <div>
                                <Badge variant={log.trigger === "MANUAL" ? "default" : "secondary"}>
                                  {log.trigger === "MANUAL" ? "دستی" : "خودکار"}
                                </Badge>
                              </div>
                              <div>
                                <Badge variant={statusConfig[log.status].variant} className="gap-1">
                                  {log.status === "STARTED" ? (
                                    <Loader2 className="size-3 animate-spin" />
                                  ) : (
                                    <StatusIcon className="size-3" />
                                  )}
                                  {statusConfig[log.status].label}
                                </Badge>
                              </div>
                              <div className="text-muted-foreground text-xs">
                                {log.metadata?.pagesProcessed ? toPersianNum(log.metadata.pagesProcessed) : "--"}
                              </div>
                              <div>{toPersianNum(log.recordsRead)}</div>
                              <div className="text-emerald-600 dark:text-emerald-400">{toPersianNum(log.recordsUpserted)}</div>
                              <div>
                                {log.recordsFailed > 0 ? (
                                  <span className="text-destructive font-medium flex items-center gap-1">
                                    {toPersianNum(log.recordsFailed)}
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground">--</span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                <Clock className="size-3 shrink-0" />
                                {formatDate(log.startedAt)}
                                {hasError && (isExpanded ? <ChevronUp className="size-3 shrink-0" /> : <ChevronDown className="size-3 shrink-0" />)}
                              </div>
                            </div>
                          </CollapsibleTrigger>
                          <CollapsibleContent>
                            <div className="border-t px-4 py-3 space-y-3 bg-muted/30">
                              {log.errorMessage && (
                                <div className="text-xs text-destructive whitespace-pre-wrap">{log.errorMessage}</div>
                              )}
                              {isSuperAdmin && errorsMeta && errorsMeta.length > 0 && (
                                <div className="space-y-2">
                                  <div className="flex items-center gap-2 text-xs font-medium">
                                    <Bug className="size-3" />
                                    جزئیات خطاها
                                    {loadingErrors.has(log.id) && <Loader2 className="size-3 animate-spin" />}
                                  </div>
                                  {!pageData && !loadingErrors.has(log.id) && (
                                    <Button variant="ghost" size="sm" className="text-xs h-6" onClick={() => void fetchErrorDetails(log.id)}>
                                      نمایش جزئیات
                                    </Button>
                                  )}
                                  {pageData && (
                                    <div className="max-h-64 overflow-y-auto space-y-1">
                                      {pageData.items.map((err, i) => (
                                        <div key={i} className="text-xs bg-background rounded p-2 border">
                                          <span className="text-muted-foreground font-medium">#{err.recordId}: </span>
                                          <span className="text-destructive">{err.message}</span>
                                        </div>
                                      ))}
                                      {pageData.totalPages > 1 && (
                                        <div className="flex gap-1 pt-1">
                                          {Array.from({ length: pageData.totalPages }, (_, i) => i + 1).map((p) => (
                                            <Button
                                              key={p}
                                              variant={p === pageData.page ? "default" : "outline"}
                                              size="sm"
                                              className="text-[10px] h-5 w-5 p-0"
                                              onClick={() => void fetchErrorDetails(log.id, p)}
                                            >
                                              {toPersianNum(p)}
                                            </Button>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </CollapsibleContent>
                        </Collapsible>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
