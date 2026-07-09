"use client"

import type { ReactNode } from "react"
import { Badge } from "@/components/ui/badge"
import { Webhook } from "lucide-react"

const FIELD_LABELS: Record<string, string> = {
  service: "خدمت",
  ig_username: "یوزرنیم اینستا",
  city: "شهر",
  email: "ایمیل",
  age: "سن",
  note: "یادداشت",
}

const INTERNAL_KEYS = new Set(["_webhookSource", "recreatedAt", "previousSource", "note"])

function formatValue(value: unknown): ReactNode {
  if (value === null || value === undefined) return "—"
  if (typeof value === "boolean") return value ? "بله" : "خیر"
  if (typeof value === "number") return String(value)
  if (typeof value === "string") return value
  if (Array.isArray(value)) {
    if (value.length === 0) return "—"
    return (
      <div className="flex flex-wrap gap-1">
        {value.map((item, i) => (
          <Badge key={i} variant="secondary" className="text-xs font-normal">
            {String(item)}
          </Badge>
        ))}
      </div>
    )
  }
  if (typeof value === "object") {
    return (
      <div className="space-y-1 text-xs">
        {Object.entries(value as Record<string, unknown>).map(([k, v]) => (
          <div key={k} className="flex gap-2">
            <span className="text-muted-foreground shrink-0">{FIELD_LABELS[k] ?? k}:</span>
            <span className="break-all">{typeof v === "object" ? JSON.stringify(v) : String(v)}</span>
          </div>
        ))}
      </div>
    )
  }
  return String(value)
}

function getLabel(key: string): string {
  return FIELD_LABELS[key] ?? key.replace(/_/g, " ")
}

export function LeadMetadataPanel({ metadata }: { metadata: Record<string, unknown> }) {
  const entries = Object.entries(metadata).filter(([key]) => !INTERNAL_KEYS.has(key))
  if (entries.length === 0) return null

  const webhookSource = metadata._webhookSource

  return (
    <div className="rounded-lg border bg-background p-3 space-y-2">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Webhook className="size-3.5 text-blue-500" />
        اطلاعات ورودی
        {typeof webhookSource === "string" && (
          <Badge variant="outline" className="text-[10px] font-normal" dir="ltr">
            {webhookSource}
          </Badge>
        )}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {entries.map(([key, value]) => (
          <div key={key} className="text-sm min-w-0">
            <div className="text-xs text-muted-foreground mb-0.5">{getLabel(key)}</div>
            <div className="font-medium break-words">{formatValue(value)}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function hasVisibleMetadata(metadata: Record<string, unknown>): boolean {
  return Object.keys(metadata).some((key) => !INTERNAL_KEYS.has(key))
}
