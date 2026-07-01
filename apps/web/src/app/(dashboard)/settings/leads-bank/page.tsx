"use client"

import { useEffect, useState } from "react"
import { apiFetch } from "@/lib/api-client"
import { useAuth } from "@/stores/auth.store"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
  SearchIcon, ChevronLeft, ChevronRight, Database,
} from "lucide-react"
import { cn } from "@/lib/utils"

type LeadSource = "INSTAGRAM" | "WHATSAPP" | "SITE" | "MANUAL"
type LeadStatus = "NEW" | "CONTACTED" | "CONVERTED" | "LOST"

interface LeadRow {
  id: string
  source: string
  sources: string[]
  status: LeadStatus
  fullName: string | null
  mobile: string | null
  externalRef: string | null
  createdAt: string
  assignedUser: { id: string; fullName: string | null } | null
}

interface Pagination {
  page: number
  limit: number
  total: number
  totalPages: number
}

const sourceLabels: Record<LeadSource, string> = {
  INSTAGRAM: "اینستاگرام", WHATSAPP: "واتساپ", SITE: "وب‌سایت", MANUAL: "دستی",
}

const statusLabels: Record<LeadStatus, string> = {
  NEW: "جدید", CONTACTED: "در پیگیری", CONVERTED: "نوبت‌دار", LOST: "از دست رفته",
}

function toPersianNum(n: number | string) {
  return String(n).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[parseInt(d)])
}

export default function LeadsBankPage() {
  const { hasPermission } = useAuth()
  const [leads, setLeads] = useState<LeadRow[]>([])
  const [pagination, setPagination] = useState<Pagination | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)

  const fetchLeads = async (p: number, q: string) => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.set("page", String(p))
      params.set("limit", "50")
      if (q) params.set("search", q)
      const res = await apiFetch<{ data: LeadRow[]; pagination: Pagination }>(`/api/admin/leads-bank?${params}`)
      setLeads(res.data)
      setPagination(res.pagination)
    } catch { setLeads([]) }
    finally { setLoading(false) }
  }

  useEffect(() => { fetchLeads(page, search) }, [page])

  const handleSearch = () => { setPage(1); fetchLeads(1, search) }

  if (!hasPermission("*")) {
    return (
      <div className="flex flex-col items-center gap-4 py-20">
        <Database className="size-12 text-muted-foreground/40" />
        <p className="text-muted-foreground">فقط مدیر سیستم دسترسی دارد</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">بانک لیدها</h1>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative w-full max-w-sm">
          <SearchIcon className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="جستجو بر اساس نام، شماره یا منبع..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            className="pr-9"
          />
        </div>
        <Button variant="outline" size="sm" onClick={handleSearch}>جستجو</Button>
        {(pagination && pagination.total > 0) && (
          <span className="text-xs text-muted-foreground">{toPersianNum(pagination.total)} لید</span>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ردیف</TableHead>
                <TableHead>شناسه</TableHead>
                <TableHead>نام</TableHead>
                <TableHead>شماره تماس</TableHead>
                <TableHead>منبع</TableHead>
                <TableHead>وضعیت</TableHead>
                <TableHead>ارجاع خارجی</TableHead>
                <TableHead>تخصیص</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={8}><Skeleton className="h-32 w-full" /></TableCell></TableRow>
              ) : leads.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="h-24 text-center text-muted-foreground">لیدی یافت نشد</TableCell></TableRow>
              ) : (
                leads.map((l, i) => (
                  <TableRow key={l.id}>
                    <TableCell className="text-xs text-muted-foreground">{toPersianNum((page - 1) * 50 + i + 1)}</TableCell>
                    <TableCell className="text-xs font-mono text-muted-foreground max-w-[100px] truncate" title={l.id}>{l.id.slice(0, 8)}...</TableCell>
                    <TableCell className="font-medium">{l.fullName || <span className="text-muted-foreground">---</span>}</TableCell>
                    <TableCell dir="ltr" className="text-xs">{l.mobile || <span className="text-muted-foreground">---</span>}</TableCell>
                    <TableCell>
                      <div className="flex gap-1 flex-wrap">
                        {(l.sources || [l.source]).map((s) => (
                          <Badge key={s} variant="outline" className="text-[10px]">{sourceLabels[s as LeadSource] || s}</Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cn("text-[10px]", l.status === "NEW" ? "text-blue-600" : l.status === "CONTACTED" ? "text-amber-600" : l.status === "CONVERTED" ? "text-emerald-600" : "text-rose-600")}>
                        {statusLabels[l.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[100px] truncate" title={l.externalRef ?? undefined}>
                      {l.externalRef || "---"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{l.assignedUser?.fullName || "---"}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
        {pagination && pagination.totalPages > 1 && (
          <CardContent className="border-t py-3">
            <div className="flex items-center justify-center gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                <ChevronRight className="size-3" /> قبلی
              </Button>
              <span className="text-xs text-muted-foreground">
                صفحه {toPersianNum(page)} از {toPersianNum(pagination.totalPages)}
              </span>
              <Button variant="outline" size="sm" disabled={page >= pagination.totalPages} onClick={() => setPage((p) => p + 1)}>
                بعدی <ChevronLeft className="size-3" />
              </Button>
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  )
}
