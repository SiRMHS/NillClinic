"use client"

import { useEffect, useState } from "react"
import { apiFetch } from "@/lib/api-client"
import { formatRial, formatRialExact, formatRecency, toPersianNum } from "@/lib/format"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { CalendarClock, Receipt, Stethoscope } from "lucide-react"

interface PatientDetail {
  patient: {
    id: string
    externalCode: number
    fullName: string | null
    mobile: string | null
    gender: number | null
    birthDate: string | null
    job: string | null
  }
  metrics: {
    visitCount: number
    totalReceived: number
    totalDiscount: number
    totalOutstanding: number
    averageTicket: number
    firstVisitDate: string | null
    lastVisitDate: string | null
    recencyDays: number | null
    recencyScore: number
    frequencyScore: number
    monetaryScore: number
    rfmScore: number
    segment: string
  } | null
  visits: {
    externalId: number
    receptionDate: string | null
    receptionNo: number | null
    userName: string | null
    totalReceived: number
    totalDiscount: number
    itemCount: number
    services: string | null
    personnel: string | null
  }[]
  topServices: { serviceName: string; times: number; revenue: number }[]
  reserves: {
    reserveDate: string | null
    reserveTime: string | null
    doctorName: string | null
    services: string | null
    isAccepted: boolean
  }[]
}

const SEGMENT_LABELS: Record<string, string> = {
  CHAMPION: "بیماران ویژه", LOYAL: "وفادار", POTENTIAL: "مستعد رشد",
  NEW: "تازه‌وارد", AT_RISK: "در خطر ریزش", DORMANT: "خفته", LOST: "از دست رفته",
}

const GENDER_LABELS: Record<number, string> = { 20: "مرد", 21: "زن" }

export function PatientDetailDialog({
  externalCode,
  open,
  onOpenChange,
}: {
  externalCode: number | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [data, setData] = useState<PatientDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || externalCode === null) return
    let active = true
    setLoading(true)
    setError(null)
    setData(null)

    apiFetch<PatientDetail>(`/api/visitors/patient/${externalCode}`)
      .then((d) => {
        if (active) setData(d)
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : "خطا در دریافت اطلاعات بیمار")
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [open, externalCode])

  const m = data?.metrics

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/*
        DialogContent is a grid. Pinning the header to an `auto` row and giving
        the body `minmax(0,1fr)` lets only the body scroll — with overflow on the
        popup itself the title scrolled away and wide tables pushed the dialog
        past the viewport instead of scrolling inside it.
      */}
      {/*
        The width override must carry the `sm:` prefix (as every other dialog in
        this app does): DialogContent's base classes include `sm:max-w-sm`, and
        tailwind-merge treats a different breakpoint as a different key, so an
        unprefixed `max-w-6xl` would silently lose above 640px.
      */}
      <DialogContent
        className="grid max-h-[90vh] w-[96vw] max-w-[96vw] grid-rows-[auto_minmax(0,1fr)] overflow-hidden sm:max-w-5xl lg:max-w-6xl"
        dir="rtl"
      >
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {loading ? (
              <Skeleton className="h-6 w-48" />
            ) : (
              <>
                <span>{data?.patient.fullName ?? "بیمار"}</span>
                {m ? <Badge variant="secondary">{SEGMENT_LABELS[m.segment] ?? m.segment}</Badge> : null}
              </>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="min-h-0 overflow-y-auto pe-1">
        {error ? (
          <div className="py-6 text-center text-sm text-rose-600 dark:text-rose-400">{error}</div>
        ) : loading ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : data ? (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
              <span>کد: {toPersianNum(data.patient.externalCode)}</span>
              {data.patient.mobile ? <span>موبایل: {toPersianNum(data.patient.mobile)}</span> : null}
              {data.patient.gender !== null ? (
                <span>{GENDER_LABELS[data.patient.gender] ?? "—"}</span>
              ) : null}
              {data.patient.birthDate ? <span>تولد: {toPersianNum(data.patient.birthDate)}</span> : null}
              {data.patient.job ? <span>شغل: {data.patient.job}</span> : null}
            </div>

            {m ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
                <Stat label="مجموع پرداخت" value={formatRial(m.totalReceived)} title={formatRialExact(m.totalReceived)} />
                <Stat label="تعداد مراجعه" value={toPersianNum(m.visitCount)} />
                <Stat label="میانگین هر مراجعه" value={formatRial(m.averageTicket)} />
                <Stat
                  label="آخرین مراجعه"
                  value={formatRecency(m.recencyDays)}
                  title={m.lastVisitDate ?? undefined}
                />
                <Stat label="مجموع تخفیف" value={formatRial(m.totalDiscount)} />
                <Stat
                  label="مانده"
                  value={m.totalOutstanding > 0 ? formatRial(m.totalOutstanding) : "—"}
                  tone={m.totalOutstanding > 0 ? "danger" : undefined}
                />
                <Stat label="اولین مراجعه" value={m.firstVisitDate ? toPersianNum(m.firstVisitDate) : "—"} />
                <Stat
                  label="امتیاز RFM"
                  value={`${toPersianNum(m.rfmScore)}`}
                  title={`R${m.recencyScore} F${m.frequencyScore} M${m.monetaryScore}`}
                />
              </div>
            ) : (
              <div className="rounded-md border border-dashed p-3 text-center text-sm text-muted-foreground">
                برای این بیمار هنوز سابقه مالی ثبت نشده است.
              </div>
            )}

            <Tabs defaultValue="visits">
              <TabsList>
                <TabsTrigger value="visits">
                  <Receipt className="size-3.5" /> مراجعات ({toPersianNum(data.visits.length)})
                </TabsTrigger>
                <TabsTrigger value="services">
                  <Stethoscope className="size-3.5" /> خدمات
                </TabsTrigger>
                <TabsTrigger value="reserves">
                  <CalendarClock className="size-3.5" /> نوبت‌ها ({toPersianNum(data.reserves.length)})
                </TabsTrigger>
              </TabsList>

              <TabsContent value="visits">
                {data.visits.length === 0 ? (
                  <Empty>مراجعه‌ای ثبت نشده است.</Empty>
                ) : (
                  <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>تاریخ</TableHead>
                        <TableHead>خدمات</TableHead>
                        <TableHead>پرسنل</TableHead>
                        <TableHead className="text-left">پرداختی</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.visits.map((v) => (
                        <TableRow key={v.externalId}>
                          <TableCell className="whitespace-nowrap tabular-nums">
                            {v.receptionDate ? toPersianNum(v.receptionDate) : "—"}
                          </TableCell>
                          <TableCell className="min-w-[16rem] max-w-[28rem] text-xs whitespace-normal">{v.services ?? "—"}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{v.personnel ?? "—"}</TableCell>
                          <TableCell
                            className="text-left tabular-nums"
                            title={formatRialExact(v.totalReceived)}
                          >
                            {formatRial(v.totalReceived)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="services">
                {data.topServices.length === 0 ? (
                  <Empty>خدمتی ثبت نشده است.</Empty>
                ) : (
                  <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>خدمت</TableHead>
                        <TableHead className="text-left">دفعات</TableHead>
                        <TableHead className="text-left">مبلغ</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.topServices.map((s) => (
                        <TableRow key={s.serviceName}>
                          <TableCell>{s.serviceName}</TableCell>
                          <TableCell className="text-left tabular-nums">{toPersianNum(s.times)}</TableCell>
                          <TableCell className="text-left tabular-nums" title={formatRialExact(s.revenue)}>
                            {formatRial(s.revenue)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="reserves">
                {data.reserves.length === 0 ? (
                  <Empty>نوبتی ثبت نشده است.</Empty>
                ) : (
                  <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>تاریخ</TableHead>
                        <TableHead>ساعت</TableHead>
                        <TableHead>پزشک</TableHead>
                        <TableHead>خدمات</TableHead>
                        <TableHead>وضعیت</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.reserves.map((r, i) => (
                        <TableRow key={`${r.reserveDate}-${r.reserveTime}-${i}`}>
                          <TableCell className="tabular-nums">
                            {r.reserveDate ? toPersianNum(r.reserveDate) : "—"}
                          </TableCell>
                          <TableCell className="tabular-nums">
                            {r.reserveTime ? toPersianNum(r.reserveTime) : "—"}
                          </TableCell>
                          <TableCell>{r.doctorName ?? "—"}</TableCell>
                          <TableCell className="text-xs">{r.services ?? "—"}</TableCell>
                          <TableCell>
                            <Badge variant={r.isAccepted ? "default" : "secondary"}>
                              {r.isAccepted ? "پذیرش شده" : "پذیرش نشده"}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>
        ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Stat({
  label, value, title, tone,
}: {
  label: string
  value: string
  title?: string
  tone?: "danger"
}) {
  return (
    <div className="rounded-lg border p-2.5" title={title}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={`mt-0.5 font-bold tabular-nums ${
          tone === "danger" ? "text-rose-600 dark:text-rose-400" : ""
        }`}
      >
        {value}
      </div>
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="py-8 text-center text-sm text-muted-foreground">{children}</div>
}
