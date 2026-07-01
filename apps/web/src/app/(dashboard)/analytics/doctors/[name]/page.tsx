"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { apiFetch } from "@/lib/api-client"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  ChevronRight,
  User,
  CalendarClock,
  Syringe,
  TrendingUp,
  Activity,
  Phone,
  ChevronLeft,
} from "lucide-react"
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts"
import { formatDate } from "@/lib/date-utils"
import Link from "next/link"

interface Reception {
  id: string
  receptionDate: string
  receptionNo: number
  treatmentItemNames: string | null
  isReturn: boolean
  userName: string
  patient: { externalCode: number; fullName: string | null } | null
}

interface Treatment {
  id: string
  planDate: string
  planName: string
  planUser: string
  reasonName: string | null
  detailsJson: Record<string, unknown>[]
  patient: { externalCode: number; fullName: string | null } | null
}

interface DoctorDetail {
  doctorName: string
  totalReceptions: number
  totalTreatments: number
  receptions: Reception[]
  treatments: Treatment[]
}

const COLORS = ["#2563eb", "#16a34a", "#d97706", "#dc2626", "#8b5cf6", "#ec4899"]

function toPersianNum(num: number | string) {
  return num.toString().replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[parseInt(d, 10)]!)
}

export default function DoctorDetailPage() {
  const { name } = useParams<{ name: string }>()
  const router = useRouter()
  const [data, setData] = useState<DoctorDetail | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    apiFetch<DoctorDetail>(`/api/analytics/doctor-detail/${encodeURIComponent(name)}`)
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [name])

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-6 md:grid-cols-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-28" />)}
        </div>
        <Skeleton className="h-64" />
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center gap-4 py-20">
        <p className="text-muted-foreground">اطلاعاتی یافت نشد</p>
        <Button variant="outline" onClick={() => router.back()}>بازگشت</Button>
      </div>
    )
  }

  const treatByMonth = (() => {
    const counts = new Map<string, number>()
    for (const t of data.treatments) {
      const month = t.planDate.slice(0, 7)
      counts.set(month, (counts.get(month) ?? 0) + 1)
    }
    return Array.from(counts.entries()).map(([period, count]) => ({ period, count })).slice(0, 12)
  })()

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Button variant="ghost" size="icon" className="size-7" onClick={() => router.push("/analytics")}>
          <ChevronRight className="size-4" />
        </Button>
        <Link href="/analytics" className="hover:underline">گزارشات و تحلیل‌ها</Link>
        <ChevronLeft className="size-4" />
        <span className="text-foreground font-medium">{data.doctorName}</span>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <Card className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-950 dark:to-blue-900 border-blue-200 dark:border-blue-800">
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-blue-500 p-3">
                <User className="size-6 text-white" />
              </div>
              <div>
                <div className="text-sm text-blue-700 dark:text-blue-300">{data.doctorName}</div>
                <div className="text-xs text-blue-500 dark:text-blue-400 mt-0.5">پزشک / اپراتور</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-emerald-500 p-3">
                <CalendarClock className="size-6 text-white" />
              </div>
              <div>
                <div className="text-2xl font-bold">{toPersianNum(data.totalReceptions)}</div>
                <div className="text-xs text-muted-foreground mt-0.5">کل نوبت‌ها</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-amber-500 p-3">
                <Syringe className="size-6 text-white" />
              </div>
              <div>
                <div className="text-2xl font-bold">{toPersianNum(data.totalTreatments)}</div>
                <div className="text-xs text-muted-foreground mt-0.5">طرح درمان</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="size-4 text-emerald-600" />
              روند طرح درمان (ماهیانه)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {treatByMonth.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={treatByMonth}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="period" fontSize={10} />
                  <YAxis fontSize={11} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#2563eb" radius={[4, 4, 0, 0]} name="تعداد" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="p-8 text-center text-muted-foreground text-sm">داده‌ای وجود ندارد</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="size-4 text-blue-600" />
              خلاصه فعالیت
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
              <span className="text-sm">نسبت تبدیل پذیرش به درمان</span>
              <Badge variant={data.totalReceptions > 0 && (data.totalTreatments / data.totalReceptions) > 0.5 ? "default" : "secondary"}>
                %{toPersianNum(data.totalReceptions > 0 ? Math.round((data.totalTreatments / data.totalReceptions) * 100) : 0)}
              </Badge>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
              <span className="text-sm">آخرین پذیرش</span>
              <span className="text-sm font-medium">{data.receptions[0] ? formatDate(data.receptions[0].receptionDate) : "---"}</span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
              <span className="text-sm">آخرین طرح درمان</span>
              <span className="text-sm font-medium">{data.treatments[0] ? formatDate(data.treatments[0].planDate) : "---"}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarClock className="size-4" />
              پذیرش‌ها
            </CardTitle>
            <Badge variant="outline">{toPersianNum(data.receptions.length)} مورد</Badge>
          </CardHeader>
          <CardContent className="p-0">
            {data.receptions.length > 0 ? (
              <div className="divide-y max-h-[400px] overflow-y-auto">
                {data.receptions.map((r) => (
                  <div key={r.id} className="p-4 flex items-center justify-between hover:bg-muted/30 transition-colors">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{r.receptionDate}</span>
                        <span className="text-xs text-muted-foreground">شماره {toPersianNum(r.receptionNo)}</span>
                      </div>
                      {r.treatmentItemNames && (
                        <div className="text-xs text-muted-foreground">{r.treatmentItemNames}</div>
                      )}
                      {r.patient && (
                        <div className="text-xs text-muted-foreground">
                          بیمار: {r.patient.fullName ?? `کد ${r.patient.externalCode}`}
                        </div>
                      )}
                    </div>
                    {r.isReturn && <Badge variant="outline" className="shrink-0">عودت</Badge>}
                  </div>
                ))}
              </div>
            ) : (
              <CardContent className="p-8 text-center text-muted-foreground">پذيرشی ثبت نشده است.</CardContent>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Syringe className="size-4" />
              طرح‌های درمانی
            </CardTitle>
            <Badge variant="outline">{toPersianNum(data.treatments.length)} مورد</Badge>
          </CardHeader>
          <CardContent className="p-0">
            {data.treatments.length > 0 ? (
              <div className="divide-y max-h-[400px] overflow-y-auto">
                {data.treatments.map((t) => (
                  <div key={t.id} className="p-4 hover:bg-muted/30 transition-colors">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium">{t.planName}</span>
                      <span className="text-xs text-muted-foreground">{t.planDate}</span>
                    </div>
                    {t.reasonName && (
                      <div className="text-xs text-muted-foreground">دلیل: {t.reasonName}</div>
                    )}
                    {t.patient && (
                      <div className="text-xs text-muted-foreground">
                        بیمار: {t.patient.fullName ?? `کد ${t.patient.externalCode}`}
                      </div>
                    )}
                    {Array.isArray(t.detailsJson) && t.detailsJson.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {t.detailsJson.map((d: Record<string, unknown>, i: number) => (
                          <Badge key={i} variant="outline" className="text-[10px]">
                            {String(d.treatmentItems ?? "")}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <CardContent className="p-8 text-center text-muted-foreground">طرح درمانی ثبت نشده است.</CardContent>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
