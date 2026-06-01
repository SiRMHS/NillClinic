"use client"

import * as React from "react"
import { Area, AreaChart, CartesianGrid, XAxis } from "recharts"

import { useIsMobile } from "@/hooks/use-mobile"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group"

const chartData = [
  { date: "۱۴۰۵/۱۰", patients: 45 },
  { date: "۱۴۰۵/۱۱", patients: 85 },
  { date: "۱۴۰۵/۱۲", patients: 120 },
  { date: "۱۴۰۶/۰۱", patients: 180 },
  { date: "۱۴۰۶/۰۲", patients: 240 },
  { date: "۱۴۰۶/۰۳", patients: 310 },
  { date: "۱۴۰۶/۰۴", patients: 280 },
  { date: "۱۴۰۶/۰۵", patients: 350 },
  { date: "۱۴۰۶/۰۶", patients: 420 },
]

const chartConfig = {
  patients: {
    label: "بیماران",
    color: "var(--primary)",
  },
} satisfies ChartConfig

export function ChartAreaInteractive() {
  const isMobile = useIsMobile()
  const [timeRange, setTimeRange] = React.useState("90d")

  React.useEffect(() => {
    if (isMobile) {
      setTimeRange("30d")
    }
  }, [isMobile])

  const filteredData = timeRange === "90d" ? chartData : chartData.slice(-5)

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>روند رشد بیماران</CardTitle>
        <CardDescription>
          <span className="hidden @[540px]/card:block">
            تعداد بیماران جدید ثبت‌شده در ماه‌های اخیر
          </span>
          <span className="@[540px]/card:hidden">ماه‌های اخیر</span>
        </CardDescription>
        <CardAction>
          <ToggleGroup
            multiple={false}
            value={timeRange ? [timeRange] : []}
            onValueChange={(value) => {
              setTimeRange(value[0] ?? "90d")
            }}
            variant="outline"
            className="hidden *:data-[slot=toggle-group-item]:px-4! @[767px]/card:flex"
          >
            <ToggleGroupItem value="90d">۶ ماه</ToggleGroupItem>
            <ToggleGroupItem value="30d">۳ ماه</ToggleGroupItem>
          </ToggleGroup>
          <Select
            value={timeRange}
            onValueChange={(value) => {
              if (value !== null) {
                setTimeRange(value)
              }
            }}
          >
            <SelectTrigger
              className="flex w-40 **:data-[slot=select-value]:block **:data-[slot=select-value]:truncate @[767px]/card:hidden"
              size="sm"
              aria-label="انتخاب بازه"
            >
              <SelectValue placeholder="۶ ماه" />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem value="90d" className="rounded-lg">۶ ماه</SelectItem>
              <SelectItem value="30d" className="rounded-lg">۳ ماه</SelectItem>
            </SelectContent>
          </Select>
        </CardAction>
      </CardHeader>
      <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
        <ChartContainer
          config={chartConfig}
          className="aspect-auto h-[250px] w-full"
        >
          <AreaChart data={filteredData}>
            <defs>
              <linearGradient id="fillPatients" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="5%"
                  stopColor="var(--color-patients)"
                  stopOpacity={1.0}
                />
                <stop
                  offset="95%"
                  stopColor="var(--color-patients)"
                  stopOpacity={0.1}
                />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={32}
            />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  labelFormatter={(value) => `تاریخ: ${value}`}
                  indicator="dot"
                />
              }
            />
            <Area
              dataKey="patients"
              type="natural"
              fill="url(#fillPatients)"
              stroke="var(--color-patients)"
              stackId="a"
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
