"use client"

import { useCallback, useEffect, useState } from "react"
import { apiFetch } from "@/lib/api-client"
import { formatCount, toPersianNum } from "@/lib/format"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  AlertTriangle, CheckCircle2, LogOut, RefreshCw, Search, ShieldAlert, XCircle,
} from "lucide-react"

interface LoginEntry {
  id: string
  at: string
  outcome: "success" | "failed" | "logout"
  reason: string | null
  email: string | null
  userAgent: string | null
  ipAddress: string | null
  fullName: string | null
}
interface Summary {
  success24h: number
  failed24h: number
  failed7d: number
  failingIps24h: number
  activeUsers24h: number
  suspiciousIps: {
    ipAddress: string
    failures: number
    distinctEmails: number
    lastAttempt: string
  }[]
}

/** Server-side reason codes → wording an operator can act on. */
const REASON_LABELS: Record<string, string> = {
  unknown_email: "ایمیل ناشناخته",
  wrong_password: "رمز اشتباه",
  inactive: "حساب غیرفعال",
  locked_out_account: "حساب قفل بود",
  locked_out_ip: "آی‌پی قفل بود",
}

const PAGE_SIZE = 50

function formatWhen(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  const date = new Intl.DateTimeFormat("fa-IR", { dateStyle: "short" }).format(d)
  const time = new Intl.DateTimeFormat("fa-IR", { timeStyle: "short", hour12: false }).format(d)
  return `${date} ${time}`
}

/** Long UA strings are noise in a table; keep the identifying part. */
function shortUserAgent(ua: string | null): string {
  if (!ua) return "—"
  const browser = /(Firefox|Edg|Chrome|Safari)\/[\d.]+/.exec(ua)?.[1]
  const os = /(Windows|Macintosh|Android|iPhone|iPad|Linux)/.exec(ua)?.[1]
  if (browser || os) return [browser, os].filter(Boolean).join(" · ")
  return ua.slice(0, 40)
}

export default function LoginLogPage() {
  const [entries, setEntries] = useState<LoginEntry[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [outcome, setOutcome] = useState<"all" | "success" | "failed">("all")
  const [searchInput, setSearchInput] = useState("")
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const qs = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(page * PAGE_SIZE),
      outcome,
    })
    if (search) qs.set("search", search)

    try {
      const [log, sum] = await Promise.all([
        apiFetch<{ total: number; entries: LoginEntry[] }>(`/api/security/login-log?${qs}`),
        apiFetch<Summary>("/api/security/login-summary"),
      ])
      setEntries(log.entries)
      setTotal(log.total)
      setSummary(sum)
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطا در دریافت گزارش ورود")
    } finally {
      setLoading(false)
    }
  }, [page, outcome, search])

  useEffect(() => {
    void load()
  }, [load])

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6" dir="rtl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">گزارش ورود</h1>
          <p className="text-sm text-muted-foreground">
            هر ورود موفق، ناموفق و خروج با آی‌پی و دستگاه ثبت می‌شود
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
          بازخوانی
        </Button>
      </div>

      {error ? (
        <Card>
          <CardContent className="py-6 text-center text-sm text-rose-600 dark:text-rose-400">{error}</CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="ورود موفق (۲۴ ساعت)" value={summary ? formatCount(summary.success24h) : "—"} tone="positive" />
        <Stat label="ورود ناموفق (۲۴ ساعت)" value={summary ? formatCount(summary.failed24h) : "—"} tone={summary && summary.failed24h > 10 ? "danger" : undefined} />
        <Stat label="ناموفق (۷ روز)" value={summary ? formatCount(summary.failed7d) : "—"} />
        <Stat label="آی‌پی با خطا (۲۴ ساعت)" value={summary ? formatCount(summary.failingIps24h) : "—"} tone={summary && summary.failingIps24h > 3 ? "warning" : undefined} />
        <Stat label="کاربران فعال (۲۴ ساعت)" value={summary ? formatCount(summary.activeUsers24h) : "—"} />
      </div>

      {summary && summary.suspiciousIps.length > 0 ? (
        <Card className="border-amber-300 dark:border-amber-900">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldAlert className="size-4 text-amber-600" />
              آی‌پی‌های مشکوک (۷ روز اخیر)
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              آدرس‌هایی با ۳ خطای ورود یا بیشتر. تعداد ایمیل‌های متمایز بالا یعنی احتمال حمله
              پاشش رمز.
            </p>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>آی‌پی</TableHead>
                    <TableHead className="text-left">خطاها</TableHead>
                    <TableHead className="text-left">ایمیل متمایز</TableHead>
                    <TableHead className="text-left">آخرین تلاش</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.suspiciousIps.map((s) => (
                    <TableRow key={s.ipAddress}>
                      <TableCell className="font-mono text-xs" dir="ltr">{s.ipAddress}</TableCell>
                      <TableCell className="text-left tabular-nums">{formatCount(s.failures)}</TableCell>
                      <TableCell className="text-left tabular-nums">
                        {s.distinctEmails > 3 ? (
                          <Badge className="bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300">
                            {formatCount(s.distinctEmails)}
                          </Badge>
                        ) : (
                          formatCount(s.distinctEmails)
                        )}
                      </TableCell>
                      <TableCell className="text-left text-xs">{formatWhen(s.lastAttempt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-base">
            تاریخچه ({formatCount(total)})
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <form
              className="relative"
              onSubmit={(e) => {
                e.preventDefault()
                setSearch(searchInput.trim())
                setPage(0)
              }}
            >
              <Search className="absolute right-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="ایمیل، آی‌پی یا نام"
                className="w-56 pr-8"
              />
            </form>
            <div className="flex gap-1">
              {([
                { key: "all", label: "همه" },
                { key: "success", label: "موفق" },
                { key: "failed", label: "ناموفق" },
              ] as const).map((o) => (
                <Button
                  key={o.key}
                  size="sm"
                  variant={outcome === o.key ? "default" : "outline"}
                  onClick={() => { setOutcome(o.key); setPage(0) }}
                >
                  {o.label}
                </Button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : entries.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">رکوردی یافت نشد.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>وضعیت</TableHead>
                    <TableHead>کاربر</TableHead>
                    <TableHead>آی‌پی</TableHead>
                    <TableHead>دستگاه</TableHead>
                    <TableHead className="text-left">زمان</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell>
                        {e.outcome === "success" ? (
                          <Badge className="gap-1 bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                            <CheckCircle2 className="size-3" /> موفق
                          </Badge>
                        ) : e.outcome === "logout" ? (
                          <Badge variant="secondary" className="gap-1">
                            <LogOut className="size-3" /> خروج
                          </Badge>
                        ) : (
                          <Badge className="gap-1 bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300">
                            <XCircle className="size-3" /> ناموفق
                          </Badge>
                        )}
                        {e.reason ? (
                          <div className="mt-0.5 text-[11px] text-muted-foreground">
                            {REASON_LABELS[e.reason] ?? e.reason}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{e.fullName ?? "—"}</div>
                        <div className="text-xs text-muted-foreground" dir="ltr">{e.email ?? "—"}</div>
                      </TableCell>
                      <TableCell className="font-mono text-xs" dir="ltr">{e.ipAddress ?? "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{shortUserAgent(e.userAgent)}</TableCell>
                      <TableCell className="text-left text-xs whitespace-nowrap">{formatWhen(e.at)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {totalPages > 1 ? (
        <div className="flex items-center justify-between">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>قبلی</Button>
          <span className="text-sm text-muted-foreground">
            صفحه {toPersianNum(page + 1)} از {toPersianNum(totalPages)}
          </span>
          <Button variant="outline" size="sm" disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}>بعدی</Button>
        </div>
      ) : null}

      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
        پیام خطای ورود عمداً برای «ایمیل ناشناخته» و «رمز اشتباه» یکسان است تا نتوان وجود یک حساب
        را از بیرون تشخیص داد؛ علت واقعی فقط در همین گزارش دیده می‌شود.
      </p>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "positive" | "warning" | "danger" }) {
  const toneClass =
    tone === "positive" ? "text-emerald-600 dark:text-emerald-400"
    : tone === "warning" ? "text-amber-600 dark:text-amber-400"
    : tone === "danger" ? "text-rose-600 dark:text-rose-400"
    : ""
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold tabular-nums ${toneClass}`}>{value}</div>
      </CardContent>
    </Card>
  )
}
