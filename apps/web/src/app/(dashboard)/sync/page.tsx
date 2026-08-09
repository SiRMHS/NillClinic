"use client"

import { useEffect, useState, useCallback, useRef, startTransition } from "react"
import { apiFetch } from "@/lib/api-client"
import { useAuth } from "@/stores/auth.store"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
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
  Power,
  RotateCcw,
  Save,
  SlidersHorizontal,
} from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

type SyncEntity = "PATIENTS" | "SERVICES" | "RESERVES" | "TREATMENTS" | "RECEPTIONS"
type SyncStatus = "STARTED" | "SUCCESS" | "PARTIAL" | "FAILED"
type SyncTrigger = "CRON" | "MANUAL" | "AUTO"
type JobStatus = "IDLE" | "RUNNING" | "COMPLETED" | "PARTIAL" | "FAILED"

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

interface JobState {
  entity: SyncEntity
  status: JobStatus
  lastPage: number
  recordsRead: number
  recordsUpserted: number
  recordsFailed: number
  reachedEnd: boolean
  startedAt: string | null
  finishedAt: string | null
  errorMessage: string | null
  updatedAt: string
}

interface AutoState {
  autoSyncEnabled: boolean
  throttleDelayMs: number
  pageSize: number
  isRunning: boolean
  jobStates: JobState[]
}

interface ErrorPage {
  items: { recordId: string; message: string }[]
  total: number
  page: number
  totalPages: number
  limit: number
}

const ALL_ENTITIES: SyncEntity[] = ["PATIENTS", "SERVICES", "RESERVES", "TREATMENTS", "RECEPTIONS"]
const AUTO_SPEED_OPTIONS = [
  { value: 100, label: "خیلی سریع — ۱۰۰ میلی‌ثانیه" },
  { value: 300, label: "سریع — ۳۰۰ میلی‌ثانیه" },
  { value: 500, label: "متعادل — ۵۰۰ میلی‌ثانیه" },
  { value: 1000, label: "آرام — ۱ ثانیه" },
  { value: 2000, label: "خیلی آرام — ۲ ثانیه" },
]
const AUTO_PAGE_SIZE_OPTIONS = [20, 25, 40, 50, 100, 125, 200]

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

const jobStatusConfig: Record<JobStatus, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  IDLE: { label: "شروع نشده", variant: "outline" },
  RUNNING: { label: "در حال اجرا", variant: "secondary" },
  COMPLETED: { label: "تکمیل شده", variant: "default" },
  PARTIAL: { label: "ناقص", variant: "outline" },
  FAILED: { label: "ناموفق", variant: "destructive" },
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

export default function SyncPage() {
  const { hasPermission } = useAuth()
  const [logs, setLogs] = useState<SyncLog[]>([])
  const [loading, setLoading] = useState(true)
  const [autoState, setAutoState] = useState<AutoState | null>(null)
  const [showErrors, setShowErrors] = useState<Set<string>>(new Set())
  const [showConfig, setShowConfig] = useState(false)
  const [filterEntity, setFilterEntity] = useState<SyncEntity | "ALL">("ALL")
  const [cancelling, setCancelling] = useState(false)
  const [purging, setPurging] = useState(false)
  const [startingSync, setStartingSync] = useState(false)
  const [togglingAuto, setTogglingAuto] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [savingAutoSettings, setSavingAutoSettings] = useState(false)
  const [autoThrottleDelayMs, setAutoThrottleDelayMs] = useState(500)
  const [autoPageSize, setAutoPageSize] = useState(50)
  const [autoSettingsDirty, setAutoSettingsDirty] = useState(false)
  const autoSettingsDirtyRef = useRef(false)

  const [maxPages, setMaxPages] = useState(2)
  const [pageSize, setPageSize] = useState(50)
  const [selectedEntities, setSelectedEntities] = useState<Set<SyncEntity>>(new Set(ALL_ENTITIES))

  const [errorDetails, setErrorDetails] = useState<Record<string, ErrorPage>>({})
  const [loadingErrors, setLoadingErrors] = useState<Set<string>>(new Set())

  const isSuperAdmin = hasPermission("*")
  const autoRunning = autoState?.isRunning ?? false
  const anyRunning = autoRunning

  const fetchLogs = useCallback(async () => {
    const params = filterEntity !== "ALL" ? `?entity=${filterEntity}` : ""
    return apiFetch<SyncLog[]>(`/api/sync/logs${params}`)
  }, [filterEntity])

  const fetchAuto = useCallback(async () => {
    return apiFetch<AutoState>("/api/sync/auto")
  }, [])

  const refresh = useCallback(async () => {
    try {
      const [auto, data] = await Promise.all([fetchAuto(), fetchLogs()])
      startTransition(() => {
        setAutoState(auto)
        setLogs(data)
        setLoading(false)
        if (!autoSettingsDirtyRef.current) {
          setAutoThrottleDelayMs(auto.throttleDelayMs)
          setAutoPageSize(auto.pageSize)
        }
      })
    } catch {
      startTransition(() => setLoading(false))
    }
  }, [fetchAuto, fetchLogs])

  useEffect(() => {
    void refresh()
    const id = setInterval(() => { void refresh() }, 2000)
    return () => clearInterval(id)
  }, [refresh])

  const toggleAuto = async (enabled: boolean) => {
    setTogglingAuto(true)
    try {
      const res = await apiFetch<{ ok: boolean; autoSyncEnabled: boolean; isRunning: boolean }>(
        "/api/sync/auto",
        { method: "POST", body: JSON.stringify({ enabled }) },
      )
      if (enabled && !res.isRunning) {
        toast.error("همه بخش‌ها تکمیل شده‌اند — ابتدا وضعیت را ریست کنید")
      } else {
        toast.success(enabled ? "سینک کامل خودکار از آخرین نقطه ادامه یافت" : "سینک کامل خودکار مکث شد")
      }
      await refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "خطا در تغییر وضعیت سینک خودکار")
    } finally {
      setTogglingAuto(false)
    }
  }

  const saveAutoSettings = async () => {
    setSavingAutoSettings(true)
    try {
      const settings = await apiFetch<{ ok: boolean; throttleDelayMs: number; pageSize: number }>(
        "/api/sync/auto/settings",
        {
          method: "PATCH",
          body: JSON.stringify({
            throttleDelayMs: autoThrottleDelayMs,
            pageSize: autoPageSize,
          }),
        },
      )
      autoSettingsDirtyRef.current = false
      setAutoSettingsDirty(false)
      setAutoThrottleDelayMs(settings.throttleDelayMs)
      setAutoPageSize(settings.pageSize)
      toast.success("تنظیمات سینک کامل خودکار ذخیره شد")
      await refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "خطا در ذخیره تنظیمات سینک خودکار")
    } finally {
      setSavingAutoSettings(false)
    }
  }

  const forceCancel = async () => {
    setCancelling(true)
    try {
      await apiFetch<{ ok: boolean; finalized: number }>("/api/sync/cancel", { method: "POST" })
      toast.success("سینک فوراً متوقف شد")
      await refresh()
    } catch {
      toast.error("خطا در توقف سینک")
    } finally {
      setCancelling(false)
    }
  }

  const resetJobs = async (entity?: SyncEntity) => {
    setResetting(true)
    try {
      await apiFetch<{ ok: boolean }>("/api/sync/auto/reset", {
        method: "POST",
        body: JSON.stringify(entity ? { entity } : {}),
      })
      toast.success(entity ? `وضعیت ${entityLabels[entity]} ریست شد` : "وضعیت همه بخش‌ها ریست شد")
      await refresh()
    } catch {
      toast.error("خطا در ریست وضعیت")
    } finally {
      setResetting(false)
    }
  }

  const purgeData = async () => {
    if (!confirm("تمام داده‌های CRM پاک می‌شوند و وضعیت سینک ریست می‌شود. ادامه می‌دهید؟")) {
      return
    }
    setPurging(true)
    try {
      const purgeRes = await apiFetch<{ ok: boolean; counts: Record<string, number> }>(
        "/api/sync/purge",
        { method: "POST" },
      )
      await resetJobs()
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

  const toggleEntity = (entity: SyncEntity) => {
    setSelectedEntities((prev) => {
      const next = new Set(prev)
      if (next.has(entity)) next.delete(entity)
      else next.add(entity)
      return next
    })
  }

  const jobMap = new Map(autoState?.jobStates.map((j) => [j.entity, j]))
  const completedCount = ALL_ENTITIES.filter((e) => jobMap.get(e)?.reachedEnd).length
  const runningEntities = new Set(
    autoState?.jobStates.filter((j) => j.status === "RUNNING").map((j) => j.entity) ?? [],
  )
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
            disabled={purging || anyRunning}
            className="text-rose-600 border-rose-200 hover:bg-rose-50"
          >
            <Database />
            {purging ? "در حال پاکسازی..." : "پاکسازی داده‌های CRM"}
          </Button>
          {anyRunning && (
            <Button variant="destructive" onClick={forceCancel} disabled={cancelling} size="lg">
              <Square />
              {cancelling ? "در حال توقف..." : "لغو فورس"}
            </Button>
          )}
        </div>
      </div>

      {/* Auto full-sync switch */}
      <Card className={cn("border-2", autoRunning ? "border-primary/60" : "border-border")}>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2 text-base">
            <div className="flex items-center gap-2">
              <Power className="size-4" />
              سینک کامل خودکار
            </div>
            <div className="flex items-center gap-3">
              {autoState && (
                <span className="text-xs text-muted-foreground">
                  {toPersianNum(completedCount)} از {toPersianNum(ALL_ENTITIES.length)} بخش تکمیل
                </span>
              )}
              <Switch
                checked={autoState?.autoSyncEnabled ?? false}
                disabled={togglingAuto || !autoState}
                onCheckedChange={(checked) => void toggleAuto(checked)}
              />
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            وقتی روشن باشد، تمام بخش‌ها چانک‌به‌چانک (هر چانک {autoState ? toPersianNum(autoState.pageSize) : "۵۰"} رکورد با تاخیر {autoState ? toPersianNum(autoState.throttleDelayMs) : "۵۰۰"} میلی‌ثانیه) تا تکمیل کامل سینک می‌شوند — بدون فشار روی سرور شما یا سرور API. وضعیت در دیتابیس ذخیره می‌شود و بعد از ری‌استارت ادامه می‌یابد.
          </p>

          <div className="rounded-xl border bg-muted/20 p-4">
            <div className="mb-4 flex items-center gap-2">
              <SlidersHorizontal className="size-4 text-primary" />
              <div>
                <h3 className="text-sm font-semibold">تنظیمات سینک کامل خودکار</h3>
                <p className="text-xs text-muted-foreground">برای تغییر تنظیمات، سینک را ابتدا مکث کنید.</p>
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
              <div className="space-y-2">
                <Label htmlFor="auto-sync-speed">سرعت دریافت صفحات</Label>
                <select
                  id="auto-sync-speed"
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                  value={autoThrottleDelayMs}
                  disabled={autoRunning || savingAutoSettings}
                  onChange={(event) => {
                    autoSettingsDirtyRef.current = true
                    setAutoSettingsDirty(true)
                    setAutoThrottleDelayMs(Number(event.target.value))
                  }}
                >
                  {AUTO_SPEED_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="auto-page-size">تعداد رکورد در هر درخواست</Label>
                <select
                  id="auto-page-size"
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                  value={autoPageSize}
                  disabled={autoRunning || savingAutoSettings}
                  onChange={(event) => {
                    autoSettingsDirtyRef.current = true
                    setAutoSettingsDirty(true)
                    setAutoPageSize(Number(event.target.value))
                  }}
                >
                  {AUTO_PAGE_SIZE_OPTIONS.map((value) => (
                    <option key={value} value={value}>{toPersianNum(value)} رکورد</option>
                  ))}
                </select>
              </div>
              <Button
                type="button"
                onClick={saveAutoSettings}
                disabled={autoRunning || savingAutoSettings || !autoSettingsDirty}
              >
                {savingAutoSettings ? <Loader2 className="animate-spin" /> : <Save />}
                ذخیره تنظیمات
              </Button>
            </div>
          </div>

          {autoRunning && (
            <div className="flex items-center gap-2 text-sm">
              <Loader2 className="size-4 animate-spin text-primary" />
              <span className="font-medium">در حال هماهنگ‌سازی...</span>
              <span className="text-muted-foreground">
                (بخش‌های در حال اجرا: {Array.from(runningEntities).map((e) => entityLabels[e]).join("، ") || "—"})
              </span>
            </div>
          )}

          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all duration-500"
              style={{ width: `${(completedCount / ALL_ENTITIES.length) * 100}%` }}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => resetJobs()}
              disabled={resetting || autoRunning}
            >
              <RotateCcw className="size-3.5" />
              ریست وضعیت همه بخش‌ها
            </Button>
          </div>
        </CardContent>
      </Card>

      {showConfig && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Settings2 />
              تنظیمات سینک دستی
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
                <p className="text-xs text-muted-foreground">تعداد صفحاتی که از هر بخش دریافت شود (سینک دستی)</p>
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
            <div className="mt-4">
              <Button onClick={() => runSync()} disabled={startingSync || selectedEntities.size === 0 || anyRunning}>
                {startingSync ? <Loader2 className="animate-spin" /> : <Play />}
                اجرای سینک دستی
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        {ALL_ENTITIES.map((entity) => {
          const job = jobMap.get(entity)
          const syncing = runningEntities.has(entity)
          const completed = job?.reachedEnd
          return (
            <Card
              key={entity}
              className={cn(
                "relative",
                job?.status === "FAILED" && "border-destructive/50",
                syncing && "border-primary/50",
                completed && "border-emerald-500/40",
              )}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <Database className={cn("size-5", entityColors[entity])} />
                    <div>
                      <div className="text-sm font-medium">{entityLabels[entity]}</div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">
                        {job?.updatedAt ? timeAgo(job.updatedAt) : "هنوز سینک نشده"}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {job && (
                      <Badge variant={jobStatusConfig[job.status].variant} className="text-[10px] gap-1">
                        {syncing && <Loader2 className="size-3 animate-spin" />}
                        {jobStatusConfig[job.status].label}
                      </Badge>
                    )}
                    {completed && (
                      <Badge variant="default" className="text-[10px] gap-1 bg-emerald-600">
                        <CheckCircle2 className="size-3" />
                        کامل
                      </Badge>
                    )}
                    {job && !completed && (
                      <span className="text-[10px] text-muted-foreground">
                        صفحه {toPersianNum(job.lastPage)}
                      </span>
                    )}
                  </div>
                </div>

                {job && (
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                    <div>
                      <div className="font-semibold">{toPersianNum(job.recordsRead)}</div>
                      <div className="text-muted-foreground">خوانده</div>
                    </div>
                    <div>
                      <div className="font-semibold text-emerald-600 dark:text-emerald-400">
                        {toPersianNum(job.recordsUpserted)}
                      </div>
                      <div className="text-muted-foreground">به‌روز</div>
                    </div>
                    <div>
                      <div className={cn("font-semibold", job.recordsFailed > 0 ? "text-destructive" : "")}>
                        {toPersianNum(job.recordsFailed)}
                      </div>
                      <div className="text-muted-foreground">خطا</div>
                    </div>
                  </div>
                )}

                {job?.errorMessage && (
                  <div className="mt-2 text-[10px] text-destructive line-clamp-2">{job.errorMessage}</div>
                )}

                <div className="mt-2 flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="flex-1 text-xs"
                    disabled={anyRunning}
                    onClick={() => runSync([entity])}
                  >
                    <Play className="size-3 ml-1" />
                    سینک دستی
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs"
                    disabled={anyRunning}
                    onClick={() => resetJobs(entity)}
                  >
                    <RotateCcw className="size-3" />
                  </Button>
                </div>
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
                                <Badge variant={log.trigger === "MANUAL" ? "default" : log.trigger === "AUTO" ? "secondary" : "outline"}>
                                  {log.trigger === "MANUAL" ? "دستی" : log.trigger === "AUTO" ? "خودکار" : "کرون"}
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
                                  <span className="text-destructive font-medium">{toPersianNum(log.recordsFailed)}</span>
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
