"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { apiFetch } from "@/lib/api-client"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  ArrowRight,
  Phone,
  MapPin,
  User,
  Calendar,
  Briefcase,
  Syringe,
  Clock,
  ChevronRight,
  BarChart3,
  TrendingUp,
  Activity,
  Tag,
} from "lucide-react"
import { formatDate, formatDateTime, calculateAge } from "@/lib/date-utils"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts"

interface PatientDetail {
  id: string
  externalCode: number
  fullName: string
  mobile: string | null
  tel: string | null
  address: string | null
  fatherName: string | null
  gender: number | null
  degree: string | null
  birthDate: string | null
  job: string | null
  isResident: boolean | null
  introduction: number | null
  residentCountry: string | null
  syncedAt: string
  treatments: Treatment[]
  reserves: Reserve[]
}

interface Treatment {
  id: string
  externalId: string
  planDate: string
  planName: string
  planUser: string
  reasonName: string | null
  detailsJson: Record<string, unknown>[]
  isDeleted: boolean
  syncedAt: string
}

interface Reserve {
  id: string
  reserveDate: string
  reserveTime: string
  doctorName: string
  isAccepted: boolean
  syncedAt: string
}

const genderLabels: Record<number, string> = {
  1: "مرد",
  21: "زن",
}

export default function PatientDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [patient, setPatient] = useState<PatientDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState("info")

  useEffect(() => {
    apiFetch<PatientDetail>(`/api/patients/${id}`)
      .then(setPatient)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [id])

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (!patient) {
    return (
      <div className="flex flex-col items-center gap-4 py-20">
        <p className="text-muted-foreground">بیمار یافت نشد</p>
        <Button variant="outline" onClick={() => router.back()}>بازگشت به لیست بیماران</Button>
      </div>
    )
  }

  const infoRows = [
    { icon: User, label: "نام پدر", value: patient.fatherName },
    { icon: Phone, label: "موبایل", value: patient.mobile, dir: "ltr" as const },
    { icon: Phone, label: "تلفن", value: patient.tel, dir: "ltr" as const },
    { icon: MapPin, label: "آدرس", value: patient.address },
    { icon: Calendar, label: "تاریخ تولد", value: (() => {
      const age = calculateAge(patient.birthDate)
      return formatDate(patient.birthDate) + (age !== null ? ` (${toPersianNum(age)} سال)` : "")
    })() },
    { icon: Briefcase, label: "شغل", value: patient.job },
    { icon: User, label: "تحصیلات", value: patient.degree },
    { icon: Calendar, label: "کشور اقامت", value: patient.residentCountry },
  ]

  const hasTreatments = patient.treatments.length > 0
  const hasReserves = patient.reserves.length > 0

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Button variant="ghost" size="icon" className="size-7" onClick={() => router.back()}>
          <ChevronRight className="size-4" />
        </Button>
        <span onClick={() => router.back()} className="hover:underline cursor-pointer">بیماران</span>
        <ArrowRight className="size-4" />
        <span className="text-foreground font-medium">{patient.fullName}</span>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList variant="line">
          <TabsTrigger value="info">
            <User className="size-4" />
            اطلاعات شخصی
          </TabsTrigger>
          <TabsTrigger value="treatments" disabled={!hasTreatments}>
            <Syringe className="size-4" />
            درمان‌ها
            {hasTreatments && <Badge variant="default" className="mr-1 size-5 p-0 text-[10px]">{patient.treatments.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="reserves" disabled={!hasReserves}>
            <Clock className="size-4" />
            نوبت‌ها
            {hasReserves && <Badge variant="default" className="mr-1 size-5 p-0 text-[10px]">{patient.reserves.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="analysis" disabled={!hasTreatments && !hasReserves}>
            <BarChart3 className="size-4" />
            تحلیل بیمار
          </TabsTrigger>
        </TabsList>

        <TabsContent value="info">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card className="lg:col-span-1">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <User />
                  {patient.fullName}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded-md">
                    کد: {patient.externalCode}
                  </span>
                  {patient.gender && (
                    <Badge variant="outline">{genderLabels[patient.gender] || `کد ${patient.gender}`}</Badge>
                  )}
                  {patient.isResident !== null && (
                    <Badge variant="secondary">{patient.isResident ? "مقیم" : "غیرمقیم"}</Badge>
                  )}
                </div>

                {infoRows.map((row) =>
                  row.value ? (
                    <div key={row.label} className="flex items-start gap-3">
                      <row.icon className="size-4 mt-0.5 text-muted-foreground shrink-0" />
                      <div className="min-w-0">
                        <div className="text-xs text-muted-foreground">{row.label}</div>
                        <div className={`text-sm ${row.dir === "ltr" ? "text-left" : ""}`} dir={row.dir}>
                          {row.value}
                        </div>
                      </div>
                    </div>
                  ) : null,
                )}

                <div className="pt-2 text-xs text-muted-foreground">
                  آخرین سینک: {formatDateTime(patient.syncedAt)}
                </div>
              </CardContent>
            </Card>

            <div className="lg:col-span-2 flex flex-col gap-6">
              {!hasTreatments && !hasReserves && (
                <Card>
                  <CardContent className="p-8 text-center text-muted-foreground">
                    اطلاعات دیگری برای این بیمار ثبت نشده است.
                  </CardContent>
                </Card>
              )}

              {hasTreatments && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Syringe />
                      آخرین طرح درمانی
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="divide-y">
                      {patient.treatments.slice(0, 3).map((t) => (
                        <div key={t.id} className="p-4 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="font-medium text-sm">{t.planName}</span>
                            <span className="text-xs text-muted-foreground">{t.planDate}</span>
                          </div>
                          {t.reasonName && (
                            <div className="text-xs text-muted-foreground">دلیل: {t.reasonName}</div>
                          )}
                          <div className="text-xs text-muted-foreground">پزشک: {t.planUser}</div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {hasReserves && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Clock />
                      آخرین نوبت‌ها
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="divide-y">
                      {patient.reserves.slice(0, 3).map((r) => (
                        <div key={r.id} className="p-4 flex items-center justify-between">
                          <div>
                            <div className="text-sm font-medium">{r.doctorName}</div>
                            <div className="text-xs text-muted-foreground">{r.reserveDate} ساعت {r.reserveTime}</div>
                          </div>
                          <Badge variant={r.isAccepted ? "default" : "secondary"}>
                            {r.isAccepted ? "تأیید شده" : "در انتظار"}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="treatments">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Syringe />
                طرح‌های درمانی
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {hasTreatments ? (
                <div className="divide-y">
                  {patient.treatments.map((t) => (
                    <div key={t.id} className="p-5 space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="font-medium text-sm">{t.planName}</span>
                          <span className="mr-2 text-xs text-muted-foreground">{t.planDate}</span>
                        </div>
                        {t.isDeleted && <Badge variant="outline">حذف شده</Badge>}
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="text-muted-foreground">پزشک: <span className="text-foreground">{t.planUser}</span></div>
                        {t.reasonName && (
                          <div className="text-muted-foreground">دلیل: <span className="text-foreground">{t.reasonName}</span></div>
                        )}
                      </div>
                      {Array.isArray(t.detailsJson) && t.detailsJson.length > 0 && (
                        <div className="space-y-1">
                          <div className="text-xs font-medium text-muted-foreground">جزئیات درمان:</div>
                          {t.detailsJson.map((d: Record<string, unknown>, i: number) => (
                            <div key={i} className="text-xs bg-muted/50 rounded-md px-3 py-2">
                              {Object.entries(d).map(([key, val]) => (
                                <div key={key} className="flex gap-2">
                                  <span className="text-muted-foreground">{key}:</span>
                                  <span>{String(val)}</span>
                                </div>
                              ))}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <CardContent className="p-8 text-center text-muted-foreground">
                  طرح درمانی برای این بیمار ثبت نشده است.
                </CardContent>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="reserves">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Clock />
                نوبت‌ها
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {hasReserves ? (
                <div className="divide-y">
                  {patient.reserves.map((r) => (
                    <div key={r.id} className="p-5 flex items-center justify-between">
                      <div className="space-y-1">
                        <div className="text-sm font-medium">{r.doctorName}</div>
                        <div className="text-xs text-muted-foreground">
                          {r.reserveDate} ساعت {r.reserveTime}
                        </div>
                      </div>
                      <Badge variant={r.isAccepted ? "default" : "secondary"}>
                        {r.isAccepted ? "تأیید شده" : "در انتظار"}
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <CardContent className="p-8 text-center text-muted-foreground">
                  نوبتی برای این بیمار ثبت نشده است.
                </CardContent>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="analysis">
          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Activity className="text-blue-600" />
                  خلاصه فعالیت
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-lg bg-muted p-4 text-center">
                    <div className="text-2xl font-bold text-blue-600">{toPersianNum(patient.treatments.length)}</div>
                    <div className="text-xs text-muted-foreground mt-1">طرح درمان</div>
                  </div>
                  <div className="rounded-lg bg-muted p-4 text-center">
                    <div className="text-2xl font-bold text-emerald-600">{toPersianNum(patient.reserves.length)}</div>
                    <div className="text-xs text-muted-foreground mt-1">نوبت</div>
                  </div>
                </div>

                {hasTreatments && (
                  <>
                    <div className="flex items-center gap-2 text-sm">
                      <TrendingUp className="size-4 text-muted-foreground" />
                      <span>آخرین طرح درمان: {patient.treatments[0]?.planDate}</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <Tag className="size-4 text-muted-foreground" />
                      <span>متداول‌ترین پزشک: {mostCommonDoctor(patient.treatments.map(t => t.planUser))}</span>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <BarChart3 className="text-amber-600" />
                  توزیع درمان‌ها بر اساس پزشک
                </CardTitle>
              </CardHeader>
              <CardContent>
                {hasTreatments ? (
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={treatmentByDoctor(patient.treatments)} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" fontSize={11} />
                      <YAxis type="category" dataKey="name" width={70} fontSize={10} />
                      <Tooltip />
                      <Bar dataKey="count" fill="#d97706" radius={[0, 4, 4, 0]} name="تعداد" />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="p-8 text-center text-muted-foreground text-sm">
                    داده‌ای برای تحلیل وجود ندارد.
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function toPersianNum(num: number | string) {
  return num.toString().replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[parseInt(d, 10)]!)
}

function mostCommonDoctor(names: string[]): string {
  const counts = new Map<string, number>()
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1)
  let best = ""
  let max = 0
  for (const [name, count] of counts) {
    if (count > max) { max = count; best = name }
  }
  return best
}

function treatmentByDoctor(treatments: Treatment[]): { name: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const t of treatments) counts.set(t.planUser, (counts.get(t.planUser) ?? 0) + 1)
  return Array.from(counts.entries()).map(([name, count]) => ({ name, count }))
}
