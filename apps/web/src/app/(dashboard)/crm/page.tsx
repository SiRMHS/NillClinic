"use client"

import { useEffect, useState } from "react"
import {
  BriefcaseBusiness,
  ContactRound,
  Globe2,
  Loader2,
  MapPin,
  Megaphone,
  UsersRound,
} from "lucide-react"
import { apiFetch } from "@/lib/api-client"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Skeleton } from "@/components/ui/skeleton"

interface DistributionItem {
  name: string
  count: number
  percent: number
}

interface PatientCrmAnalysis {
  totalPatients: number
  generatedAt: string
  genderDistribution: DistributionItem[]
  residenceDistribution: DistributionItem[]
  residentStatusDistribution: DistributionItem[]
  introductionDistribution: DistributionItem[]
  occupationDistribution: DistributionItem[]
}

const persianNumber = new Intl.NumberFormat("fa-IR")
const persianPercent = new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 2 })

function DistributionTable({ items }: { items: DistributionItem[] }) {
  if (items.length === 0) {
    return <div className="py-16 text-center text-muted-foreground">داده‌ای ثبت نشده است</div>
  }

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div key={item.name} className="rounded-xl border bg-card p-4">
          <div className="mb-2 flex items-center justify-between gap-4">
            <span className="font-medium">{item.name}</span>
            <span className="shrink-0 text-sm text-muted-foreground">
              {persianNumber.format(item.count)} نفر · {persianPercent.format(item.percent)}٪
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-500"
              style={{ width: `${Math.max(item.percent, item.count > 0 ? 1 : 0)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

function AnalysisPanel({
  title,
  description,
  items,
}: {
  title: string
  description: string
  items: DistributionItem[]
}) {
  const recorded = items
    .filter((item) => item.name !== "ثبت نشده")
    .reduce((sum, item) => sum + item.count, 0)

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent>
        <div className="mb-5 rounded-lg bg-muted/50 px-4 py-3 text-sm">
          تعداد رکوردهای دارای اطلاعات: <strong>{persianNumber.format(recorded)}</strong>
        </div>
        <DistributionTable items={items} />
      </CardContent>
    </Card>
  )
}

export default function CrmPage() {
  const [data, setData] = useState<PatientCrmAnalysis | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    apiFetch<PatientCrmAnalysis>("/api/analytics/crm/patients")
      .then((result) => {
        if (active) setData(result)
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "دریافت تحلیل CRM ناموفق بود")
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [])

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <Card>
        <CardContent className="flex min-h-52 items-center justify-center text-destructive">
          {error || "اطلاعات تحلیل در دسترس نیست"}
        </CardContent>
      </Card>
    )
  }

  const tabs = [
    { value: "residence", label: "محل اقامت", icon: MapPin },
    { value: "resident", label: "وضعیت اقامت", icon: Globe2 },
    { value: "introduction", label: "نحوه آشنایی", icon: Megaphone },
    { value: "gender", label: "جنسیت", icon: UsersRound },
    { value: "occupation", label: "شغل", icon: BriefcaseBusiness },
  ] as const

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <ContactRound className="size-6" />
            CRM
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">تحلیل کامل اطلاعات ثبت‌شده بیماران کلینیک</p>
        </div>
        <Card className="min-w-52">
          <CardContent className="flex items-center justify-between gap-6 p-4">
            <div>
              <p className="text-xs text-muted-foreground">کل بیماران</p>
              <p className="text-2xl font-bold">{persianNumber.format(data.totalPatients)}</p>
            </div>
            <UsersRound className="size-8 text-primary" />
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="residence" dir="rtl">
        <TabsList className="h-auto w-full flex-wrap justify-start gap-1 p-1">
          {tabs.map(({ value, label, icon: Icon }) => (
            <TabsTrigger key={value} value={value} className="min-h-9 px-3">
              <Icon className="size-4" />
              {label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="residence">
          <AnalysisPanel title="محل اقامت بیماران" description="توزیع کشور محل اقامت ثبت‌شده در پرونده بیماران" items={data.residenceDistribution} />
        </TabsContent>
        <TabsContent value="resident">
          <AnalysisPanel title="وضعیت اقامت" description="مقایسه بیماران مقیم، غیرمقیم و پرونده‌های بدون اطلاعات" items={data.residentStatusDistribution} />
        </TabsContent>
        <TabsContent value="introduction">
          <AnalysisPanel title="نحوه آشنایی با کلینیک" description="کانالی که بیمار از طریق آن با کلینیک آشنا شده است" items={data.introductionDistribution} />
        </TabsContent>
        <TabsContent value="gender">
          <AnalysisPanel title="ترکیب جنسیتی بیماران" description="توزیع جنسیت بر اساس اطلاعات ثبت‌شده در CRM" items={data.genderDistribution} />
        </TabsContent>
        <TabsContent value="occupation">
          <AnalysisPanel title="مشاغل بیماران" description="توزیع کامل عناوین شغلی ثبت‌شده، بدون محدود کردن به چند مورد اول" items={data.occupationDistribution} />
        </TabsContent>
      </Tabs>

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="hidden size-3" />
        آخرین محاسبه: {new Date(data.generatedAt).toLocaleString("fa-IR")}
      </p>
    </div>
  )
}
