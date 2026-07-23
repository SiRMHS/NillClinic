"use client"

import { useEffect, useRef, useState } from "react"
import { apiFetch } from "@/lib/api-client"
import { cn } from "@/lib/utils"
import { formatDateTime } from "@/lib/date-utils"
import { toast } from "sonner"
import {
  PhoneCall, StickyNote, FileText, UserPlus, UserMinus,
  MessageSquare, CalendarCheck, Send, Loader2,
  CheckCircle2, Clock,
} from "lucide-react"
import {
  type Lead, type Interaction,
  callStatusConfig, callOutcomeConfig, toPersianNum,
} from "@/components/leads/constants"

type ChatEventKind = "CALL" | "NOTE" | "ASSIGN" | "UNASSIGN" | "FOLLOWUP" | "APPOINTMENT" | "MESSAGE" | "REPORT"

interface ChatEvent {
  id: string
  kind: ChatEventKind
  side: "agent" | "system"
  title: string
  body?: string
  createdAt: string
  meta?: string
}

function buildEvents(lead: Lead): ChatEvent[] {
  const events: ChatEvent[] = []

  for (const c of lead.calls) {
    const cfg = callStatusConfig[c.callStatus]
    const parts = [cfg.label]
    if (c.callOutcome) parts.push(callOutcomeConfig[c.callOutcome].label)
    events.push({
      id: c.id,
      kind: "CALL",
      side: "agent",
      title: `تماس — ${parts.join(" · ")}`,
      body: c.notes ?? undefined,
      createdAt: c.createdAt,
      meta: c.user?.fullName ?? undefined,
    })
  }

  for (const it of lead.interactions as Interaction[]) {
    const type = (it.type || "NOTE") as ChatEventKind
    const isSystem = type === "ASSIGN" || type === "UNASSIGN"
    events.push({
      id: it.id,
      kind: type,
      side: isSystem ? "system" : "agent",
      title: typeLabel(type),
      body: it.content,
      createdAt: it.createdAt,
    })
  }

  for (const f of lead.followUps) {
    events.push({
      id: f.id,
      kind: "FOLLOWUP",
      side: "system",
      title: f.status === "COMPLETED"
        ? `فالوآپ #${toPersianNum(f.attemptNumber)} انجام شد`
        : f.status === "CANCELLED"
        ? `فالوآپ #${toPersianNum(f.attemptNumber)} لغو شد`
        : `فالوآپ #${toPersianNum(f.attemptNumber)} برنامه‌ریزی شد`,
      body: f.reason ?? f.notes ?? undefined,
      createdAt: f.status === "COMPLETED" ? (f.completedAt ?? f.createdAt) : f.createdAt,
      meta: formatDateTime(f.scheduledAt),
    })
  }

  for (const a of lead.appointments) {
    events.push({
      id: a.id,
      kind: "APPOINTMENT",
      side: "agent",
      title: `نوبت ثبت شد — ${toPersianNum(a.reserveDate)} ساعت ${toPersianNum(a.reserveTime)}`,
      body: [a.doctorName, a.serviceName].filter(Boolean).join(" · ") || undefined,
      createdAt: a.createdAt,
      meta: a.user?.fullName ?? undefined,
    })
  }

  return events.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
}

function typeLabel(type: ChatEventKind): string {
  switch (type) {
    case "CALL": return "تماس"
    case "NOTE": return "یادداشت"
    case "ASSIGN": return "تخصیص"
    case "UNASSIGN": return "لغو تخصیص"
    case "FOLLOWUP": return "فالوآپ"
    case "APPOINTMENT": return "نوبت"
    case "MESSAGE": return "پیام"
    case "REPORT": return "گزارش"
  }
}

function kindIcon(kind: ChatEventKind) {
  switch (kind) {
    case "CALL": return PhoneCall
    case "NOTE": return StickyNote
    case "ASSIGN": return UserPlus
    case "UNASSIGN": return UserMinus
    case "FOLLOWUP": return Clock
    case "APPOINTMENT": return CalendarCheck
    case "MESSAGE": return MessageSquare
    case "REPORT": return FileText
  }
}

function DateDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center my-3">
      <span className="text-[10px] font-medium text-muted-foreground bg-muted/60 rounded-full px-3 py-1">
        {label}
      </span>
    </div>
  )
}

function dayLabel(iso: string): string {
  try {
    return new Intl.DateTimeFormat("fa-IR", {
      weekday: "long", year: "numeric", month: "long", day: "numeric",
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

function sameDay(a: string, b: string) {
  return new Date(a).toDateString() === new Date(b).toDateString()
}

export interface LeadChatHistoryProps {
  lead: Lead
  onUpdated: (lead: Lead) => void
}

export function LeadChatHistory({ lead, onUpdated }: LeadChatHistoryProps) {
  const events = buildEvents(lead)
  const [draft, setDraft] = useState("")
  const [sending, setSending] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lead.id, events.length])

  const sendNote = async () => {
    const content = draft.trim()
    if (!content) return
    setSending(true)
    try {
      const interaction = await apiFetch<Interaction>(`/api/leads/${lead.id}/interactions`, {
        method: "POST",
        body: JSON.stringify({ type: "NOTE", content }),
      })
      onUpdated({
        ...lead,
        interactions: [interaction, ...lead.interactions],
      })
      setDraft("")
      if (taRef.current) taRef.current.style.height = "auto"
      toast.success("یادداشت ثبت شد")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "خطا در ثبت یادداشت")
    } finally {
      setSending(false)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      void sendNote()
    }
  }

  const autosize = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setDraft(e.target.value)
    const el = e.target
    el.style.height = "auto"
    el.style.height = Math.min(el.scrollHeight, 120) + "px"
  }

  let lastDay = ""

  return (
    <div className="flex flex-col h-full min-h-0">
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-1">
        {events.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center py-10">
            <div className="size-12 rounded-full bg-muted flex items-center justify-center mb-3">
              <MessageSquare className="size-5 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium">هنوز پیگیری ثبت نشده</p>
            <p className="text-xs text-muted-foreground mt-1">
              اولین یادداشت یا تماس خود را ثبت کنید تا تاریخچه شکل بگیرد
            </p>
          </div>
        )}

        {events.map((ev) => {
          const Icon = kindIcon(ev.kind)
          const isAgent = ev.side === "agent"
          const showDay = !sameDay(ev.createdAt, lastDay)
          if (showDay) lastDay = ev.createdAt

          return (
            <div key={ev.id}>
              {showDay && <DateDivider label={dayLabel(ev.createdAt)} />}
              <div className={cn("flex gap-2 items-end", isAgent ? "flex-row-reverse" : "flex-row")}>
                <div
                  className={cn(
                    "shrink-0 size-7 rounded-full flex items-center justify-center mt-1",
                    isAgent
                      ? "bg-violet-100 text-violet-600 dark:bg-violet-950 dark:text-violet-300"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  <Icon className="size-3.5" />
                </div>
                <div className={cn("max-w-[80%] min-w-0", isAgent ? "items-end" : "items-start")}>
                  <div
                    className={cn(
                      "rounded-2xl px-3.5 py-2.5 text-sm wrap-break-word whitespace-pre-wrap",
                      isAgent
                        ? "bg-violet-600 text-white rounded-bl-md"
                        : "bg-muted text-foreground rounded-br-md"
                    )}
                  >
                    {ev.kind === "APPOINTMENT" && (
                      <div className="flex items-center gap-1.5 mb-0.5 opacity-90">
                        <CalendarCheck className="size-3.5" />
                        <span className="text-[11px] font-medium">نوبت</span>
                      </div>
                    )}
                    {ev.kind === "CALL" && (
                      <div className="flex items-center gap-1.5 mb-0.5 opacity-90">
                        <PhoneCall className="size-3.5" />
                        <span className="text-[11px] font-medium">{callStatusConfig[lookupCallStatus(ev.title)].label}</span>
                      </div>
                    )}
                    {ev.body && <div className="leading-relaxed">{ev.body}</div>}
                    {!ev.body && ev.title && <div className="leading-relaxed">{ev.title}</div>}
                    {ev.meta && (
                      <div className={cn("text-[10px] mt-1.5 opacity-80", isAgent ? "text-violet-100" : "text-muted-foreground")}>
                        {ev.meta}
                      </div>
                    )}
                  </div>
                  <div className={cn("text-[10px] text-muted-foreground mt-1 px-1", isAgent ? "text-end" : "text-start")}>
                    {formatDateTime(ev.createdAt)}
                    {ev.kind === "CALL" && <CheckCircle2 className="size-3 inline mx-1 text-blue-500" />}
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <div className="border-t bg-background p-3">
        <div className="flex items-end gap-2 rounded-2xl border bg-muted/40 p-2 focus-within:ring-2 focus-within:ring-violet-300 transition">
          <textarea
            ref={taRef}
            value={draft}
            onChange={autosize}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder="یادداشت پیگیری بنویسید... (Enter + Cmd/Ctrl برای ارسال)"
            className="flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground max-h-30 leading-relaxed"
          />
          <button
            type="button"
            onClick={() => void sendNote()}
            disabled={!draft.trim() || sending}
            className="shrink-0 size-9 rounded-xl bg-violet-600 text-white flex items-center justify-center hover:bg-violet-700 disabled:opacity-40 disabled:pointer-events-none transition"
          >
            {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          </button>
        </div>
      </div>
    </div>
  )
}

function lookupCallStatus(title: string): keyof typeof callStatusConfig {
  for (const key of Object.keys(callStatusConfig) as (keyof typeof callStatusConfig)[]) {
    if (title.includes(callStatusConfig[key].label)) return key
  }
  return "ANSWERED"
}
