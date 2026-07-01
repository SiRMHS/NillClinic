"use client"

import { useEffect, useState } from "react"
import { apiFetch } from "@/lib/api-client"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Input } from "@/components/ui/input"
import {
  MessageSquare, PhoneCall, FileText, StickyNote, SearchIcon,
  UserPlus, UserMinus, Filter,
} from "lucide-react"
import { formatDateTime } from "@/lib/date-utils"

interface UserRef {
  id: string
  fullName: string | null
}

interface Interaction {
  id: string
  leadId: string
  type: string
  content: string
  createdAt: string
  user?: UserRef | null
}

interface LeadWithInteractions {
  id: string
  fullName: string | null
  mobile: string | null
  source: string
  status: string
  externalRef: string | null
  createdAt: string
  interactions: Interaction[]
}

const typeIcons: Record<string, React.ReactNode> = {
  NOTE: <StickyNote className="size-3.5" />,
  CALL: <PhoneCall className="size-3.5" />,
  REPORT: <FileText className="size-3.5" />,
  MESSAGE: <MessageSquare className="size-3.5" />,
  ASSIGN: <UserPlus className="size-3.5" />,
  UNASSIGN: <UserMinus className="size-3.5" />,
}

const typeColors: Record<string, string> = {
  NOTE: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  CALL: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  REPORT: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  MESSAGE: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300",
  ASSIGN: "bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300",
  UNASSIGN: "bg-rose-100 text-rose-700 dark:bg-rose-900 dark:text-rose-300",
}

const typeLabels: Record<string, string> = {
  NOTE: "یادداشت",
  CALL: "تماس تلفنی",
  REPORT: "گزارش",
  MESSAGE: "پیام",
  ASSIGN: "تخصیص",
  UNASSIGN: "برداشتن تخصیص",
}

function toPersianNum(num: number | string) {
  return num.toString().replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[parseInt(d, 10)]!)
}

export default function LeadsLogPage() {
  const [leads, setLeads] = useState<LeadWithInteractions[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [typeFilter, setTypeFilter] = useState<string | null>(null)

  useEffect(() => {
    apiFetch<LeadWithInteractions[]>("/api/leads")
      .then(setLeads)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const allInteractions = leads.flatMap((l) =>
    l.interactions.map((i) => ({
      ...i,
      leadName: l.fullName,
      leadSource: l.source,
      leadStatus: l.status,
    }))
  ).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  const filtered = allInteractions.filter((i) => {
    if (search && !i.leadName?.includes(search) && !i.content.includes(search)) return false
    if (typeFilter && i.type !== typeFilter) return false
    return true
  })

  const totalInteractions = allInteractions.length
  const byType: Record<string, number> = {}
  for (const i of allInteractions) {
    byType[i.type] = (byType[i.type] ?? 0) + 1
  }

  const allTypes = ["NOTE", "CALL", "REPORT", "MESSAGE", "ASSIGN", "UNASSIGN"]

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">لاگ فعالیت‌ها و تخصیص لیدها</h1>
        <p className="text-sm text-muted-foreground mt-1">
          تاریخچه کامل فعالیت‌ها، تماس‌ها و تخصیص لیدها
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold">{toPersianNum(totalInteractions)}</div>
            <div className="text-xs text-muted-foreground">کل فعالیت‌ها</div>
          </CardContent>
        </Card>
        {Object.entries(byType).slice(0, 3).map(([type, count]) => (
          <Card key={type}>
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold">{toPersianNum(count)}</div>
              <div className="text-xs text-muted-foreground">{typeLabels[type] || type}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <div className="relative w-full max-w-sm">
          <SearchIcon className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="جستجو در مخاطبان و محتوای فعالیت‌ها..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pr-9"
          />
        </div>
        <div className="flex gap-1 flex-wrap">
          {[null, ...allTypes].map((t) => (
            <Button
              key={t ?? "all"}
              variant={typeFilter === t ? "default" : "outline"}
              size="sm"
              onClick={() => setTypeFilter(t)}
            >
              {t ? typeLabels[t] : "همه"}
            </Button>
          ))}
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="size-4" />
            گزارش فعالیت‌ها
          </CardTitle>
          <CardDescription>
            {toPersianNum(filtered.length)} مورد از مجموع {toPersianNum(totalInteractions)} فعالیت
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <CardContent className="p-8">
              <Skeleton className="h-48 w-full" />
            </CardContent>
          ) : filtered.length > 0 ? (
            <div className="divide-y">
              {filtered.map((item) => (
                <div key={item.id} className="p-4 flex items-start gap-3 hover:bg-muted/30 transition-colors">
                  <div className={`rounded-full p-2 shrink-0 ${typeColors[item.type] || "bg-muted"}`}>
                    {typeIcons[item.type] || <StickyNote className="size-3.5" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="text-[10px]">
                        {typeLabels[item.type] || item.type}
                      </Badge>
                      <span className="text-sm font-medium truncate">{item.leadName || "بدون نام"}</span>
                      <Badge variant="outline" className="text-[10px]">{item.leadSource}</Badge>
                    </div>
                    <div className="text-sm text-muted-foreground mt-1 line-clamp-2">{item.content}</div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                      <span>{formatDateTime(item.createdAt)}</span>
                      {item.user && (
                        <span className="flex items-center gap-1">
                          <span className="text-muted-foreground">توسط</span>
                          <span className="font-medium text-foreground">{item.user.fullName || "نامشخص"}</span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <CardContent className="p-8 text-center text-muted-foreground">
              هیچ فعالیتی برای نمایش وجود ندارد.
            </CardContent>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
