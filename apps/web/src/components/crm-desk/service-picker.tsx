"use client"

import { useMemo, useState } from "react"
import { Check, Search, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

export interface ServiceSection {
  section: string
  services: string[]
}

/**
 * Tick services off the clinic's own catalogue.
 *
 * The field this replaces was free text, so the same procedure arrived spelled
 * four ways and nothing could be grouped afterwards. The catalogue is ~230
 * services across ~29 sections, which is far too many for a flat checkbox list
 * and too many for a `<select>` — so the list is filtered by a search box and
 * grouped by section, and what is already picked is pulled out to the top where
 * it can be removed without hunting for it again.
 *
 * Services that are not in the catalogue are still honoured: a contact imported
 * from the old spreadsheet, or one recorded before a service was renamed, keeps
 * its value and shows in the picked row like any other. Dropping those would
 * silently rewrite what the desk recorded.
 */
export function ServicePicker({
  label,
  hint,
  catalogue,
  value,
  onChange,
  emptyHint = "خدمتی انتخاب نشده",
}: {
  label: string
  hint?: string
  catalogue: ServiceSection[]
  value: string[]
  onChange: (next: string[]) => void
  emptyHint?: string
}) {
  const [query, setQuery] = useState("")

  const picked = useMemo(() => new Set(value), [value])

  const filtered = useMemo(() => {
    const q = query.trim()
    if (!q) return catalogue
    return catalogue
      .map((group) => ({
        section: group.section,
        services: group.services.filter((s) => s.includes(q)),
      }))
      .filter((group) => group.services.length > 0 || group.section.includes(q))
  }, [catalogue, query])

  const toggle = (service: string) => {
    onChange(picked.has(service) ? value.filter((s) => s !== service) : [...value, service])
  }

  return (
    <div className="grid gap-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
        {value.length > 0 ? (
          <button
            type="button"
            onClick={() => onChange([])}
            className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
          >
            حذف همه
          </button>
        ) : null}
      </div>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}

      {/*
        The picked row is the answer to "what did I just choose" — with 230
        options behind a search box, scrolling back through the list to check is
        not a reasonable thing to ask of someone on a phone call.
      */}
      <div className="flex flex-wrap gap-1.5">
        {value.length === 0 ? (
          <span className="text-xs text-muted-foreground">{emptyHint}</span>
        ) : (
          value.map((service) => (
            <Badge key={service} variant="secondary" className="gap-1 pl-1">
              {service}
              <button
                type="button"
                onClick={() => toggle(service)}
                aria-label={`حذف ${service}`}
                className="rounded-full p-0.5 hover:bg-foreground/10"
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))
        )}
      </div>

      <div className="relative">
        <Search className="absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="جستجوی خدمت…"
          className="pr-8 text-sm"
        />
      </div>

      <div className="max-h-56 overflow-y-auto rounded-md border bg-muted/20">
        {filtered.length === 0 ? (
          <p className="p-4 text-center text-xs text-muted-foreground">
            خدمتی با این نام پیدا نشد
          </p>
        ) : (
          filtered.map((group) => (
            <div key={group.section} className="border-b last:border-b-0">
              <p className="sticky top-0 bg-muted/80 px-2.5 py-1 text-[11px] font-medium text-muted-foreground backdrop-blur">
                {group.section}
              </p>
              <div className="grid gap-0.5 p-1 sm:grid-cols-2">
                {group.services.map((service) => {
                  const active = picked.has(service)
                  return (
                    <button
                      key={service}
                      type="button"
                      onClick={() => toggle(service)}
                      className={cn(
                        "flex items-center gap-2 rounded px-2 py-1 text-right text-xs transition-colors",
                        active
                          ? "bg-primary/10 font-medium text-primary"
                          : "hover:bg-accent",
                      )}
                    >
                      <span
                        className={cn(
                          "flex size-3.5 shrink-0 items-center justify-center rounded-[4px] border",
                          active ? "border-primary bg-primary text-primary-foreground" : "border-input",
                        )}
                      >
                        {active ? <Check className="size-2.5" /> : null}
                      </span>
                      <span className="truncate">{service}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
