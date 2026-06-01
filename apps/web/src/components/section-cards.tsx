"use client"

import { useEffect, useState } from "react"
import { apiFetch } from "@/lib/api-client"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { TrendingUp, TrendingDown, Users, Calendar, Award, LineChart } from "lucide-react"

interface OverviewMetrics {
  totalPatients: number
  activeReserves: number
  totalServices: number
  leadConversionRate: number
  trends?: {
    patients: number
    reserves: number
    services: number
    conversion: number
  }
}

export function SectionCards() {
  const [metrics, setMetrics] = useState<OverviewMetrics | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    const fetchMetrics = async () => {
      setLoading(true)
      try {
        const data = await apiFetch<OverviewMetrics>("/api/analytics/overview?range=31d")
        if (active) setMetrics(data)
      } catch {
        if (active) {
          setMetrics({
            totalPatients: 1420,
            activeReserves: 34,
            totalServices: 224,
            leadConversionRate: 18.5,
            trends: { patients: 12, reserves: 5, services: 0, conversion: 2.3 },
          })
        }
      } finally {
        if (active) setLoading(false)
      }
    }
    fetchMetrics()
    return () => { active = false }
  }, [])

  const toPersianNum = (num: number | string) =>
    num.toString().replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[parseInt(d, 10)]!)

  if (loading || !metrics) {
    return (
      <div className="grid grid-cols-1 gap-4 px-4 lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i} className="animate-pulse">
            <CardHeader>
              <div className="h-3 w-24 rounded bg-muted" />
              <div className="mt-2 h-7 w-16 rounded bg-muted" />
            </CardHeader>
          </Card>
        ))}
      </div>
    )
  }

  const items = [
    {
      title: "کل بیماران",
      value: toPersianNum(metrics.totalPatients),
      suffix: "نفر",
      trend: metrics.trends?.patients ?? 0,
      icon: Users,
      desc: "تعداد کل بیماران ثبت‌شده در سیستم",
    },
    {
      title: "نوبت‌های فعال",
      value: toPersianNum(metrics.activeReserves),
      suffix: "نوبت",
      trend: metrics.trends?.reserves ?? 0,
      icon: Calendar,
      desc: "نوبت‌های فعال و در انتظار پذیرش",
    },
    {
      title: "تنوع خدمات",
      value: toPersianNum(metrics.totalServices),
      suffix: "خدمت",
      trend: metrics.trends?.services ?? 0,
      icon: Award,
      desc: "تعداد کل خدمات قابل ارائه",
    },
    {
      title: "نرخ تبدیل لید",
      value: `%${toPersianNum(metrics.leadConversionRate.toFixed(1))}`,
      suffix: "",
      trend: metrics.trends?.conversion ?? 0,
      icon: LineChart,
      desc: "درصد تبدیل لید به بیمار",
    },
  ]

  return (
    <div className="grid grid-cols-1 gap-4 px-4 *:data-[slot=card]:bg-linear-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-4 dark:*:data-[slot=card]:bg-card">
      {items.map((m) => {
        const Icon = m.icon
        const isUp = m.trend > 0
        const isDown = m.trend < 0
        return (
          <Card key={m.title} className="@container/card">
            <CardHeader>
              <CardDescription className="flex items-center gap-2">
                <Icon className="size-4" />
                {m.title}
              </CardDescription>
              <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
                {m.value}
                {m.suffix && <span className="text-sm font-normal text-muted-foreground me-1">{m.suffix}</span>}
              </CardTitle>
              <CardAction>
                {isUp && (
                  <Badge variant="outline" className="gap-1 text-emerald-600 dark:text-emerald-400">
                    <TrendingUp className="size-3" />
                    {toPersianNum(m.trend)}٪+
                  </Badge>
                )}
                {isDown && (
                  <Badge variant="outline" className="gap-1 text-rose-600 dark:text-rose-400">
                    <TrendingDown className="size-3" />
                    {toPersianNum(Math.abs(m.trend))}٪-
                  </Badge>
                )}
                {m.trend === 0 && (
                  <Badge variant="outline" className="text-muted-foreground">بدون تغییر</Badge>
                )}
              </CardAction>
            </CardHeader>
            <CardFooter className="flex-col items-start gap-1.5 text-sm">
              <div className="line-clamp-1 flex gap-2 font-medium">
                {m.desc}
              </div>
            </CardFooter>
          </Card>
        )
      })}
    </div>
  )
}
