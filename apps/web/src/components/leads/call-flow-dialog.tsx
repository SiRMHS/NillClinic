"use client"

import { useState } from "react"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import {
  PhoneCall, ArrowRight, ArrowLeft, Calendar, CheckCircle2,
  XCircle, RotateCcw, Ban, Loader2,
} from "lucide-react"
import {
  type CallOutcome, type CallStatus, type Lead,
  callOutcomeConfig, callStatusConfig,
} from "./constants"
import { JalaliDateTimePicker } from "@/components/ui/jalali-date-picker"
import { useDialLink } from "@/stores/telephony.store"
import { jalaliToIso, offsetJalaliDate } from "@/lib/jalali-date"

interface CallFlowDialogProps {
  lead: Lead | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (data: CallFlowData) => Promise<void>
}

export interface CallFlowData {
  callStatus: CallStatus
  callOutcome?: CallOutcome
  serviceReceived?: boolean
  notes?: string
  appointment?: {
    reserveDate: string
    reserveTime: string
    doctorName: string
    serviceName?: string
    notes?: string
  }
  followUp?: {
    scheduledAt: string
    reason?: string
    notes?: string
  }
}

type Step = "status" | "outcome" | "service" | "appointment" | "followup"

const noAnswerStatuses: CallStatus[] = ["NO_ANSWER", "BUSY", "VOICEMAIL", "WRONG_NUMBER"]

export function CallFlowDialog({ lead, open, onOpenChange, onSubmit }: CallFlowDialogProps) {
  const dialLink = useDialLink()
  const dialHref = dialLink(lead?.mobile)
  const [step, setStep] = useState<Step>("status")
  const [callStatus, setCallStatus] = useState<CallStatus | null>(null)
  const [callOutcome, setCallOutcome] = useState<CallOutcome | null>(null)
  const [serviceReceived, setServiceReceived] = useState<boolean | null>(null)
  const [notes, setNotes] = useState("")
  const [reserveDate, setReserveDate] = useState("")
  const [reserveTime, setReserveTime] = useState("")
  const [doctorName, setDoctorName] = useState("")
  const [serviceName, setServiceName] = useState("")
  const [followUpDate, setFollowUpDate] = useState("")
  const [followUpTime, setFollowUpTime] = useState("")
  const [followUpReason, setFollowUpReason] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const reset = () => {
    setStep("status")
    setCallStatus(null)
    setCallOutcome(null)
    setServiceReceived(null)
    setNotes("")
    setReserveDate("")
    setReserveTime("")
    setDoctorName("")
    setServiceName("")
    setFollowUpDate("")
    setFollowUpTime("")
    setFollowUpReason("")
  }

  const handleClose = (v: boolean) => {
    if (!v) reset()
    onOpenChange(v)
  }

  const handleStatusSelect = (status: CallStatus) => {
    setCallStatus(status)
    if (status === "ANSWERED") {
      setStep("outcome")
    } else {
      setStep("followup")
      setFollowUpDate(offsetJalaliDate(1))
      setFollowUpTime("10:00")
      setFollowUpReason(callStatusConfig[status].label)
    }
  }

  const handleOutcomeSelect = (outcome: CallOutcome) => {
    setCallOutcome(outcome)
    if (outcome === "NO_INTEREST") {
      setServiceReceived(false)
      setStep("followup")
      setFollowUpReason("تمایلی به دریافت خدمت ندارد")
    } else if (outcome === "CALLBACK_REQUESTED") {
      setStep("followup")
      setFollowUpDate(offsetJalaliDate(1))
      setFollowUpTime("10:00")
      setFollowUpReason("درخواست تماس مجدد")
    } else {
      setStep("service")
    }
  }

  const handleServiceSelect = (received: boolean) => {
    setServiceReceived(received)
    if (received) {
      setCallOutcome("SERVICE_ACCEPTED")
      setStep("appointment")
      setReserveDate(offsetJalaliDate(1))
      setReserveTime("10:00")
    } else {
      setCallOutcome("SERVICE_DECLINED")
      setStep("followup")
      setFollowUpDate(offsetJalaliDate(1))
      setFollowUpTime("10:00")
      setFollowUpReason("خدمت دریافت نشد — پیگیری مجدد")
    }
  }

  const buildFollowUpIso = () => {
    if (!followUpDate || !followUpTime) return null
    try {
      return jalaliToIso(followUpDate, followUpTime)
    } catch {
      return null
    }
  }

  const handleSubmit = async () => {
    if (!callStatus) return
    setSubmitting(true)
    try {
      const data: CallFlowData = { callStatus, notes: notes || undefined }

      if (callOutcome) data.callOutcome = callOutcome
      if (serviceReceived !== null) data.serviceReceived = serviceReceived

      if (step === "appointment" || (serviceReceived && reserveDate)) {
        data.appointment = {
          reserveDate,
          reserveTime,
          doctorName,
          serviceName: serviceName || undefined,
          notes: notes || undefined,
        }
      }

      const followUpIso = buildFollowUpIso()
      if (followUpIso && (noAnswerStatuses.includes(callStatus) || !serviceReceived || callOutcome === "CALLBACK_REQUESTED")) {
        if (callOutcome !== "NO_INTEREST" || followUpDate) {
          data.followUp = {
            scheduledAt: followUpIso,
            reason: followUpReason || undefined,
            notes: notes || undefined,
          }
        }
      }

      await onSubmit(data)
      handleClose(false)
    } finally {
      setSubmitting(false)
    }
  }

  const stepTitles: Record<Step, string> = {
    status: "وضعیت تماس",
    outcome: "نتیجه مکالمه",
    service: "دریافت خدمت",
    appointment: "ثبت نوبت",
    followup: "زمان‌بندی پیگیری",
  }

  const canSubmit = () => {
    if (step === "appointment") {
      return reserveDate && reserveTime && doctorName
    }
    if (step === "followup") {
      if (callOutcome === "NO_INTEREST") return true
      return followUpDate && followUpTime
    }
    return false
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md" showCloseButton>
        <DialogHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <DialogTitle className="flex items-center gap-2">
                <PhoneCall className="size-4 text-violet-600" />
                ثبت تماس — {lead?.fullName || "بدون نام"}
              </DialogTitle>
              <DialogDescription className="mt-1">
                {lead?.mobile ? (
                  <span dir="ltr" className="inline-block">{lead.mobile}</span>
                ) : (
                  "بدون شماره"
                )}
                {" · "}مرحله: {stepTitles[step]}
              </DialogDescription>
            </div>
            {dialHref && (
              <a
                href={dialHref}
                className={cn(buttonVariants({ size: "sm" }), "shrink-0 gap-1.5 inline-flex")}
              >
                <PhoneCall className="size-4" />
                تماس
              </a>
            )}
          </div>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Progress dots */}
          <div className="flex items-center justify-center gap-1.5">
            {(["status", "outcome", "service", "appointment"] as Step[]).map((s, i) => (
              <div
                key={s}
                className={cn(
                  "h-1.5 rounded-full transition-all",
                  step === s ? "w-8 bg-violet-600" :
                  ["status", "outcome", "service", "appointment"].indexOf(step) > i
                    ? "w-4 bg-violet-300"
                    : "w-4 bg-muted"
                )}
              />
            ))}
          </div>

          {step === "status" && (
            <div className="grid grid-cols-2 gap-2">
              {(Object.entries(callStatusConfig) as [CallStatus, typeof callStatusConfig[CallStatus]][]).map(([key, cfg]) => {
                const Icon = cfg.icon
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => handleStatusSelect(key)}
                    className={cn(
                      "flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all hover:border-violet-300 hover:bg-violet-50/50 dark:hover:bg-violet-950/20",
                      callStatus === key ? "border-violet-500 bg-violet-50 dark:bg-violet-950/30" : "border-border"
                    )}
                  >
                    <Icon className={cn("size-6", cfg.color)} />
                    <span className="text-sm font-medium">{cfg.label}</span>
                  </button>
                )
              })}
            </div>
          )}

          {step === "outcome" && (
            <div className="grid grid-cols-2 gap-2">
              {([
                { key: "SERVICE_ACCEPTED" as CallOutcome, label: "علاقه‌مند به خدمت", icon: CheckCircle2, color: "text-emerald-600" },
                { key: "SERVICE_DECLINED" as CallOutcome, label: "نیاز به فکر کردن", icon: XCircle, color: "text-amber-600" },
                { key: "CALLBACK_REQUESTED" as CallOutcome, label: "تماس بعداً", icon: RotateCcw, color: "text-blue-600" },
                { key: "NO_INTEREST" as CallOutcome, label: "تمایلی ندارد", icon: Ban, color: "text-rose-600" },
              ]).map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => handleOutcomeSelect(item.key)}
                  className={cn(
                    "flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all hover:border-violet-300",
                    callOutcome === item.key ? "border-violet-500 bg-violet-50 dark:bg-violet-950/30" : "border-border"
                  )}
                >
                  <item.icon className={cn("size-6", item.color)} />
                  <span className="text-sm font-medium text-center">{item.label}</span>
                </button>
              ))}
            </div>
          )}

          {step === "service" && (
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => handleServiceSelect(true)}
                className="flex flex-col items-center gap-3 p-6 rounded-xl border-2 border-emerald-200 bg-emerald-50/50 hover:bg-emerald-100/50 dark:border-emerald-900 dark:bg-emerald-950/20 transition-all"
              >
                <CheckCircle2 className="size-10 text-emerald-600" />
                <span className="font-semibold text-emerald-700 dark:text-emerald-300">خدمت گرفت</span>
                <span className="text-xs text-muted-foreground text-center">ثبت نوبت برای بیمار</span>
              </button>
              <button
                type="button"
                onClick={() => handleServiceSelect(false)}
                className="flex flex-col items-center gap-3 p-6 rounded-xl border-2 border-amber-200 bg-amber-50/50 hover:bg-amber-100/50 dark:border-amber-900 dark:bg-amber-950/20 transition-all"
              >
                <XCircle className="size-10 text-amber-600" />
                <span className="font-semibold text-amber-700 dark:text-amber-300">خدمت نگرفت</span>
                <span className="text-xs text-muted-foreground text-center">ثبت فالوآپ پیگیری</span>
              </button>
            </div>
          )}

          {step === "appointment" && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 text-sm">
                <Calendar className="size-4 shrink-0" />
                نوبت برای این مخاطب ثبت می‌شود
              </div>
              <JalaliDateTimePicker
                dateLabel="تاریخ نوبت"
                timeLabel="ساعت"
                dateValue={reserveDate}
                timeValue={reserveTime}
                onDateChange={setReserveDate}
                onTimeChange={setReserveTime}
              />
              <div className="space-y-1.5">
                <Label htmlFor="doctorName">نام پزشک</Label>
                <Input id="doctorName" placeholder="دکتر ..." value={doctorName} onChange={(e) => setDoctorName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="serviceName">نام خدمت (اختیاری)</Label>
                <Input id="serviceName" placeholder="بوتاکس، فیلر، ..." value={serviceName} onChange={(e) => setServiceName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="apptNotes">یادداشت</Label>
                <Input id="apptNotes" placeholder="توضیحات..." value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
            </div>
          )}

          {step === "followup" && (
            <div className="space-y-3">
              {callOutcome === "NO_INTEREST" ? (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 text-sm">
                  <Ban className="size-4 shrink-0" />
                  لید به عنوان «از دست رفته» علامت‌گذاری می‌شود
                </div>
              ) : (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 text-sm">
                  <RotateCcw className="size-4 shrink-0" />
                  فالوآپ برای پیگیری مجدد ثبت می‌شود
                </div>
              )}
              {callOutcome !== "NO_INTEREST" && (
                <>
                  <JalaliDateTimePicker
                    dateLabel="تاریخ پیگیری"
                    timeLabel="ساعت"
                    dateValue={followUpDate}
                    timeValue={followUpTime}
                    onDateChange={setFollowUpDate}
                    onTimeChange={setFollowUpTime}
                  />
                  <div className="space-y-1.5">
                    <Label htmlFor="followUpReason">دلیل پیگیری</Label>
                    <Input id="followUpReason" value={followUpReason} onChange={(e) => setFollowUpReason(e.target.value)} />
                  </div>
                </>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="followNotes">یادداشت تماس</Label>
                <Input id="followNotes" placeholder="خلاصه مکالمه..." value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          {step !== "status" && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (step === "followup" && callStatus && callStatus !== "ANSWERED") setStep("status")
                else if (step === "followup") setStep(serviceReceived === false ? "service" : "outcome")
                else if (step === "appointment") setStep("service")
                else if (step === "service") setStep("outcome")
                else if (step === "outcome") setStep("status")
              }}
            >
              <ArrowRight className="size-4" />
              بازگشت
            </Button>
          )}
          {(step === "appointment" || step === "followup") && (
            <Button type="button" onClick={handleSubmit} disabled={!canSubmit() || submitting}>
              {submitting ? <Loader2 className="size-4 animate-spin" /> : <ArrowLeft className="size-4" />}
              {step === "appointment" ? "ثبت نوبت و تماس" : "ثبت فالوآپ"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { callOutcomeConfig }
