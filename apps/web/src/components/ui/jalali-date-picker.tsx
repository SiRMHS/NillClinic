"use client"

import { useEffect, useId, useState } from "react"
import DatePicker from "react-multi-date-picker"
import persian from "react-date-object/calendars/persian"
import persian_fa from "react-date-object/locales/persian_fa"
import DateObject from "react-date-object"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { Calendar } from "lucide-react"

import "react-multi-date-picker/styles/colors/purple.css"
import "react-multi-date-picker/styles/layouts/mobile.css"

interface JalaliDatePickerProps {
  id?: string
  label?: string
  value?: string
  onChange?: (jalaliDate: string) => void
  placeholder?: string
  className?: string
  disabled?: boolean
}

export function JalaliDatePicker({
  id: idProp,
  label,
  value = "",
  onChange,
  placeholder = "انتخاب تاریخ",
  className,
  disabled,
}: JalaliDatePickerProps) {
  const autoId = useId()
  const id = idProp ?? autoId
  const [internal, setInternal] = useState<DateObject | null>(null)

  useEffect(() => {
    if (!value) {
      setInternal(null)
      return
    }
    const parts = value.split("/").map(Number)
    if (parts.length === 3 && parts.every((n) => !Number.isNaN(n))) {
      setInternal(new DateObject({ year: parts[0], month: parts[1], day: parts[2], calendar: persian }))
    }
  }, [value])

  return (
    <div className={cn("space-y-1.5", className)}>
      {label && <Label htmlFor={id}>{label}</Label>}
      <div className="relative">
        <DatePicker
          id={id}
          disabled={disabled}
          value={internal}
          onChange={(d) => {
            if (!d || Array.isArray(d)) return
            const date = d as DateObject
            setInternal(date)
            onChange?.(date.format("YYYY/MM/DD"))
          }}
          calendar={persian}
          locale={persian_fa}
          format="YYYY/MM/DD"
          placeholder={placeholder}
          containerClassName="w-full"
          inputClass="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 pe-9"
          arrowClassName="hidden"
          calendarPosition="bottom-center"
        />
        <Calendar className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
      </div>
    </div>
  )
}

interface JalaliDateTimePickerProps {
  dateLabel?: string
  timeLabel?: string
  dateValue?: string
  timeValue?: string
  onDateChange?: (jalaliDate: string) => void
  onTimeChange?: (time: string) => void
  className?: string
}

export function JalaliDateTimePicker({
  dateLabel = "تاریخ",
  timeLabel = "ساعت",
  dateValue,
  timeValue,
  onDateChange,
  onTimeChange,
  className,
}: JalaliDateTimePickerProps) {
  return (
    <div className={cn("grid grid-cols-2 gap-3", className)}>
      <JalaliDatePicker label={dateLabel} value={dateValue} onChange={onDateChange} />
      <div className="space-y-1.5">
        <Label htmlFor="jalali-time">{timeLabel}</Label>
        <input
          id="jalali-time"
          type="time"
          value={timeValue ?? ""}
          onChange={(e) => onTimeChange?.(e.target.value)}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
      </div>
    </div>
  )
}
