"use client"

import { useMemo } from "react"
import { addJalaliDays, jalaliToday, parseJalali, formatJalali, toLatinDigits } from "@jordan/shared"
import { Button } from "@/components/ui/button"
import { JalaliDatePicker } from "@/components/ui/jalali-date-picker"
import { Badge } from "@/components/ui/badge"
import { toPersianNum } from "@/lib/format"
import { CalendarRange, X } from "lucide-react"

export interface DateRange {
  from: string
  to: string
}

/**
 * Jalali range filter with quick presets.
 *
 * Values are normalized to ASCII digits before leaving this component: the
 * underlying picker renders Persian numerals and emits them verbatim
 * (`۱۴۰۵/۰۵/۲۱`), which no `\d`-based validator can match. The API normalizes
 * too, but a query string full of `%DB%B1` escapes is also unreadable in logs
 * and dev tools.
 */
function normalize(value: string): string {
  const parts = parseJalali(toLatinDigits(value))
  return parts ? formatJalali(parts) : ""
}

interface Preset {
  label: string
  /** null ⇒ clear the range (all time). */
  range: () => DateRange | null
}

export function DateRangeFilter({
  value,
  onChange,
  className,
}: {
  value: DateRange
  onChange: (range: DateRange) => void
  className?: string
}) {
  const presets: Preset[] = useMemo(() => {
    const today = jalaliToday()
    const back = (days: number): DateRange => ({ from: addJalaliDays(today, -days), to: today })
    const parts = parseJalali(today)
    const yearStart = parts ? `${parts.jy}/01/01` : today

    return [
      { label: "امروز", range: () => ({ from: today, to: today }) },
      { label: "۷ روز", range: () => back(6) },
      { label: "۳۰ روز", range: () => back(29) },
      { label: "۳ ماه", range: () => back(89) },
      { label: "امسال", range: () => ({ from: yearStart, to: today }) },
      { label: "همه", range: () => null },
    ]
  }, [])

  const active = value.from !== "" || value.to !== ""

  /** Which preset (if any) the current range corresponds to. */
  const activePreset = useMemo(() => {
    if (!active) return "همه"
    for (const p of presets) {
      const r = p.range()
      if (r && r.from === value.from && r.to === value.to) return p.label
    }
    return null
  }, [presets, value, active])

  const set = (next: DateRange | null) => {
    onChange(next ? { from: normalize(next.from), to: normalize(next.to) } : { from: "", to: "" })
  }

  return (
    <div className={`flex flex-wrap items-end gap-2 ${className ?? ""}`}>
      <div className="flex flex-wrap items-center gap-1">
        {presets.map((p) => {
          const isActive = activePreset === p.label
          return (
            <Button
              key={p.label}
              type="button"
              size="sm"
              variant={isActive ? "default" : "outline"}
              onClick={() => set(p.range())}
            >
              {p.label}
            </Button>
          )
        })}
      </div>

      <JalaliDatePicker
        label="از تاریخ"
        value={value.from}
        onChange={(d) => set({ from: d, to: value.to })}
        className="w-36"
      />
      <JalaliDatePicker
        label="تا تاریخ"
        value={value.to}
        onChange={(d) => set({ from: value.from, to: d })}
        className="w-36"
      />

      {active ? (
        <div className="flex items-center gap-1.5 pb-0.5">
          <Badge variant="secondary" className="gap-1">
            <CalendarRange className="size-3" />
            {value.from ? toPersianNum(value.from) : "ابتدا"} —{" "}
            {value.to ? toPersianNum(value.to) : "امروز"}
          </Badge>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => set(null)}
            title="حذف فیلتر تاریخ"
          >
            <X className="size-3.5" />
          </Button>
        </div>
      ) : null}
    </div>
  )
}
