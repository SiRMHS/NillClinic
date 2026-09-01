"use client"

import { useState } from "react"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { JalaliDatePicker } from "@/components/ui/jalali-date-picker"
import { cn } from "@/lib/utils"
import { Loader2 } from "lucide-react"
import {
  CRM_CALL_RESULT_LABELS, CRM_CHANNEL_LABELS, CRM_CONTACT_KIND_LABELS,
  CRM_LIKELIHOOD_LABELS, CRM_RATING_FIELDS, CRM_RATING_LABELS,
  jalaliToday,
  splitCrmLabels,
  type CrmCallResult, type CrmChannel, type CrmContactKind,
  type CrmLikelihood, type CrmRating,
} from "@jordan/shared"
import { useCrmMasking } from "@/stores/display.store"
import { ServicePicker, type ServiceSection } from "./service-picker"
import type { CrmContact } from "./types"

/** `null` clears the field on the server; `undefined` leaves it untouched. */
type Draft = Record<string, unknown>

const NONE = "__none__"

/**
 * Optional enum selects need a value that means "no answer given".
 *
 * The select primitive treats `""` as unset and shows the placeholder, but it
 * cannot round-trip a deliberate clear — picking the sentinel and mapping it
 * back to `null` is what lets a rating be removed after it was set by mistake.
 */
function OptionalSelect<T extends string>({
  id, label, value, options, onChange, placeholder = "—",
}: {
  id: string
  label: string
  value: T | null
  options: Record<T, string>
  onChange: (next: T | null) => void
  placeholder?: string
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">{label}</Label>
      <Select
        value={value ?? NONE}
        onValueChange={(v) => onChange(v === NONE ? null : (v as T))}
      >
        <SelectTrigger id={id}><SelectValue placeholder={placeholder} /></SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>{placeholder}</SelectItem>
          {(Object.entries(options) as [T, string][]).map(([k, v]) => (
            <SelectItem key={k} value={k}>{v}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function TextArea({
  id, label, value, onChange, rows = 2, placeholder,
}: {
  id: string
  label: string
  value: string
  onChange: (next: string) => void
  rows?: number
  placeholder?: string
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">{label}</Label>
      <textarea
        id={id}
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm",
          "transition-colors outline-none placeholder:text-muted-foreground",
          "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
          "dark:bg-input/30",
        )}
      />
    </div>
  )
}

export interface ContactDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** `null` opens the form empty, for a new contact. */
  contact: CrmContact | null
  defaultKind: CrmContactKind
  doctors: string[]
  /** The clinic's service list, grouped by section — see ServicePicker. */
  serviceCatalogue: ServiceSection[]
  onSubmit: (payload: Draft, id: string | null) => Promise<void>
}

export function ContactDialog({ open, onOpenChange, ...rest }: ContactDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        {/*
          Keyed and mounted only while open, so switching rows rebuilds the form
          from scratch. The alternative — copying the contact into state from an
          effect — re-rendered the whole dialog once per open and let a cancelled
          edit bleed into the next row if the reset ever missed a field.
        */}
        {open && <ContactForm key={rest.contact?.id ?? "new"} onOpenChange={onOpenChange} {...rest} />}
      </DialogContent>
    </Dialog>
  )
}

function ContactForm({
  onOpenChange, contact, defaultKind, doctors, serviceCatalogue, onSubmit,
}: Omit<ContactDialogProps, "open">) {
  const [saving, setSaving] = useState(false)
  const [kind, setKind] = useState<CrmContactKind>(contact?.kind ?? defaultKind)
  const [patientExternalCode, setPatientExternalCode] = useState(contact?.patientExternalCode?.toString() ?? "")
  const [patientName, setPatientName] = useState(contact?.patientName ?? "")
  const [patientMobile, setPatientMobile] = useState(contact?.patientMobile ?? "")
  const [doctorName, setDoctorName] = useState(contact?.doctorName ?? "")
  const [visitDate, setVisitDate] = useState(contact?.visitDate ?? "")
  const [contactDate, setContactDate] = useState(contact?.contactDate ?? jalaliToday())
  /**
   * Picked services, falling back to splitting the old free-text column.
   *
   * Rows recorded before the picker existed — and everything the spreadsheet
   * import brought in — have `serviceName` and an empty `serviceNames`. Opening
   * one of those for editing has to show its services, otherwise saving an
   * unrelated correction would silently blank them.
   */
  const [serviceNames, setServiceNames] = useState<string[]>(
    contact?.serviceNames?.length ? contact.serviceNames : splitCrmLabels(contact?.serviceName),
  )
  const [amountText, setAmountText] = useState(contact?.amountText ?? "")
  // When the site hides CRM money, the amount never reached this dialog — the
  // API stripped it. The field is therefore not shown, and, crucially, the key
  // is left out of the payload entirely: sending the empty box back would
  // erase an amount the editor was never allowed to read.
  const { amounts: amountsHidden } = useCrmMasking()
  const [ratings, setRatings] = useState<Record<string, CrmRating | null>>({
    schedulingRating: contact?.schedulingRating ?? null,
    doctorRating: contact?.doctorRating ?? null,
    assistantRating: contact?.assistantRating ?? null,
    receptionRating: contact?.receptionRating ?? null,
    hygieneRating: contact?.hygieneRating ?? null,
  })
  const [referralLikelihood, setReferral] = useState<CrmLikelihood | null>(contact?.referralLikelihood ?? null)
  const [revisitLikelihood, setRevisit] = useState<CrmLikelihood | null>(contact?.revisitLikelihood ?? null)
  const [channels, setChannels] = useState<CrmChannel[]>(contact?.channels ?? [])
  const [callResult, setCallResult] = useState<CrmCallResult | null>(contact?.callResult ?? null)
  const [suggestion, setSuggestion] = useState(contact?.suggestion ?? "")
  const [notes, setNotes] = useState(contact?.notes ?? "")
  const [rebookNote, setRebookNote] = useState(contact?.rebookNote ?? "")
  const [resultsOnset, setResultsOnset] = useState(contact?.resultsOnset ?? "")
  const [sideEffect, setSideEffect] = useState(contact?.sideEffect ?? "")
  const [overallOpinion, setOverallOpinion] = useState(contact?.overallOpinion ?? "")
  const [showAdvanced, setShowAdvanced] = useState(
    Boolean(
      contact?.painSwelling || contact?.delayComplaint || contact?.positiveNote ||
      contact?.patientSummary || contact?.callCenterReferral ||
      contact?.resurveyDate || contact?.resurveyResult,
    ),
  )
  const [painSwelling, setPainSwelling] = useState(contact?.painSwelling ?? "")
  const [delayComplaint, setDelayComplaint] = useState(contact?.delayComplaint ?? "")
  const [positiveNote, setPositiveNote] = useState(contact?.positiveNote ?? "")
  const [doctorReferral, setDoctorReferral] = useState(contact?.doctorReferral ?? "")
  const [patientSummary, setPatientSummary] = useState(contact?.patientSummary ?? "")
  const [callCenterReferral, setCallCenterReferral] = useState(contact?.callCenterReferral ?? "")
  const [resurveyDate, setResurveyDate] = useState(contact?.resurveyDate ?? "")
  const [resurveyResult, setResurveyResult] = useState(contact?.resurveyResult ?? "")

  // ─── Referral after consultation ───
  const [referredDoctorName, setReferredDoctorName] = useState(contact?.referredDoctorName ?? "")
  const [treatmentDoctorName, setTreatmentDoctorName] = useState(contact?.treatmentDoctorName ?? "")
  const [treatmentServiceNames, setTreatmentServiceNames] = useState<string[]>(
    contact?.treatmentServiceNames ?? [],
  )
  const [treatmentDate, setTreatmentDate] = useState(contact?.treatmentDate ?? "")
  // Opened when the row already carries a referral, so an existing one is never
  // hidden behind a collapsed section the editor has to know to expand.
  const [showReferral, setShowReferral] = useState(
    Boolean(contact?.referredDoctorName || contact?.treatmentDoctorName || contact?.doctorReferral),
  )


  const trimmed = (v: string) => (v.trim() === "" ? null : v.trim())

  const handleSubmit = async () => {
    if (!contactDate) return
    setSaving(true)
    try {
      const code = Number(patientExternalCode)
      await onSubmit(
        {
          kind,
          patientExternalCode: patientExternalCode.trim() && Number.isInteger(code) && code > 0 ? code : null,
          patientName: trimmed(patientName),
          patientMobile: trimmed(patientMobile),
          doctorName: trimmed(doctorName),
          visitDate: trimmed(visitDate),
          contactDate,
          serviceNames,
          ...(amountsHidden ? {} : { amountText: trimmed(amountText) }),
          ...ratings,
          referralLikelihood,
          revisitLikelihood,
          channels,
          callResult,
          suggestion: trimmed(suggestion),
          notes: trimmed(notes),
          rebookNote: trimmed(rebookNote),
          resultsOnset: trimmed(resultsOnset),
          sideEffect: trimmed(sideEffect),
          overallOpinion: trimmed(overallOpinion),
          painSwelling: trimmed(painSwelling),
          delayComplaint: trimmed(delayComplaint),
          positiveNote: trimmed(positiveNote),
          doctorReferral: trimmed(doctorReferral),
          patientSummary: trimmed(patientSummary),
          callCenterReferral: trimmed(callCenterReferral),
          resurveyDate: trimmed(resurveyDate),
          resurveyResult: trimmed(resurveyResult),
          referredDoctorName: trimmed(referredDoctorName),
          treatmentDoctorName: trimmed(treatmentDoctorName),
          treatmentServiceNames,
          treatmentDate: trimmed(treatmentDate),
        },
        contact?.id ?? null,
      )
      onOpenChange(false)
    } finally {
      setSaving(false)
    }
  }

  const toggleChannel = (c: CrmChannel) => {
    setChannels((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]))
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{contact ? "ویرایش تماس" : "ثبت تماس جدید"}</DialogTitle>
        <DialogDescription>
          نتیجه تماس فالوآپ یا نظرسنجی بیمار را ثبت کنید. امتیاز رضایت، NPS و ریسک ریزش خودکار محاسبه می‌شود.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="grid gap-1.5">
            <Label htmlFor="kind" className="text-xs text-muted-foreground">نوع</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as CrmContactKind)}>
              <SelectTrigger id="kind"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(CRM_CONTACT_KIND_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="code" className="text-xs text-muted-foreground">شماره پرونده بیمار</Label>
            <Input
              id="code"
              inputMode="numeric"
              value={patientExternalCode}
              onChange={(e) => setPatientExternalCode(e.target.value)}
              placeholder="مثلاً ۱۲۱۸۰۰"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="pname" className="text-xs text-muted-foreground">نام بیمار</Label>
            <Input
              id="pname"
              value={patientName}
              onChange={(e) => setPatientName(e.target.value)}
              placeholder="در صورت وجود پرونده، خودکار پر می‌شود"
            />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="grid gap-1.5">
            <Label htmlFor="mobile" className="text-xs text-muted-foreground">موبایل</Label>
            <Input id="mobile" inputMode="numeric" value={patientMobile} onChange={(e) => setPatientMobile(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="doctor" className="text-xs text-muted-foreground">نام پزشک</Label>
            <Input
              id="doctor"
              list="crm-doctor-list"
              value={doctorName}
              onChange={(e) => setDoctorName(e.target.value)}
            />
            <datalist id="crm-doctor-list">
              {doctors.map((d) => <option key={d} value={d} />)}
            </datalist>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="referredDoctor" className="text-xs text-muted-foreground">
              ارجاع به پزشک
            </Label>
            <Input
              id="referredDoctor"
              list="crm-doctor-list"
              value={referredDoctorName}
              onChange={(e) => setReferredDoctorName(e.target.value)}
              placeholder="در صورت ارجاع پس از مشاوره"
            />
          </div>
        </div>

        <ServicePicker
          label="خدمات انجام شده"
          hint="از فهرست خدمات کلینیک انتخاب کنید — همان نام‌هایی که در پذیرش ثبت می‌شود."
          catalogue={serviceCatalogue}
          value={serviceNames}
          onChange={setServiceNames}
        />

        <div className="grid gap-3 sm:grid-cols-3">
          <JalaliDatePicker label="تاریخ مراجعه" value={visitDate} onChange={setVisitDate} />
          <JalaliDatePicker label="تاریخ تماس" value={contactDate} onChange={setContactDate} />
          {!amountsHidden && (
            <div className="grid gap-1.5">
              <Label htmlFor="amount" className="text-xs text-muted-foreground">مبلغ دریافت شده</Label>
              <Input
                id="amount"
                value={amountText}
                onChange={(e) => setAmountText(e.target.value)}
                placeholder="مثلاً ۱۰ میلیون و ۹۰۰ هزار تومان"
              />
            </div>
          )}
        </div>

        <div className="rounded-lg border p-3">
          <p className="mb-3 text-xs font-medium text-muted-foreground">امتیاز رضایت</p>
          <div className="grid gap-3 sm:grid-cols-5">
            {CRM_RATING_FIELDS.map((f) => (
              <OptionalSelect
                key={f.key}
                id={f.key}
                label={f.label}
                value={ratings[f.key] ?? null}
                options={CRM_RATING_LABELS}
                onChange={(v) => setRatings((prev) => ({ ...prev, [f.key]: v }))}
              />
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <OptionalSelect
            id="referral" label="احتمال معرفی به دیگران" value={referralLikelihood}
            options={CRM_LIKELIHOOD_LABELS} onChange={setReferral}
          />
          <OptionalSelect
            id="revisit" label="احتمال مراجعه مجدد" value={revisitLikelihood}
            options={CRM_LIKELIHOOD_LABELS} onChange={setRevisit}
          />
          <OptionalSelect
            id="callResult" label="پاسخگویی" value={callResult}
            options={CRM_CALL_RESULT_LABELS} onChange={setCallResult}
          />
        </div>

        <div className="grid gap-1.5">
          <Label className="text-xs text-muted-foreground">نحوه آشنایی</Label>
          <div className="flex flex-wrap gap-2">
            {(Object.entries(CRM_CHANNEL_LABELS) as [CrmChannel, string][]).map(([k, v]) => (
              <button
                key={k}
                type="button"
                onClick={() => toggleChannel(k)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs transition-colors",
                  channels.includes(k)
                    ? "border-primary bg-primary/10 font-medium text-primary"
                    : "border-input text-muted-foreground hover:bg-accent",
                )}
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <TextArea id="notes" label="توضیحات" value={notes} onChange={setNotes} rows={3} />
          <TextArea id="suggestion" label="پیشنهاد" value={suggestion} onChange={setSuggestion} rows={3} />
        </div>

        <TextArea id="rebook" label="وقت مجدد" value={rebookNote} onChange={setRebookNote} />

        {kind === "RENUVION" && (
          <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-3">
            <TextArea id="onset" label="بروز نتایج" value={resultsOnset} onChange={setResultsOnset} />
            <TextArea id="side" label="عوارض" value={sideEffect} onChange={setSideEffect} />
            <TextArea id="opinion" label="نظر کلی" value={overallOpinion} onChange={setOverallOpinion} />
          </div>
        )}

        {/*
          Referral outcome. Collapsed by default because most follow-up calls are
          not referrals, and the five fields would otherwise push the ratings —
          which every call fills in — below the fold.
        */}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => setShowReferral((v) => !v)}>
            {showReferral ? "بستن درمان ارجاعی" : "درمان ارجاعی (اختیاری)"}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setShowAdvanced((v) => !v)}>
            {showAdvanced ? "بستن جزییات تماس" : "جزییات تماس (اختیاری)"}
          </Button>
        </div>

        {showReferral && (
          <div className="grid gap-3 rounded-lg border p-3">
            <p className="text-xs font-medium text-muted-foreground">
              درمان ارجاعی — پس از ارجاع، نزد کدام پزشک انجام شد و چه خدمتی گرفته شد
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="grid gap-1.5">
                <Label htmlFor="treatDoctor" className="text-xs text-muted-foreground">
                  درمان توسط
                </Label>
                <Input
                  id="treatDoctor"
                  list="crm-doctor-list"
                  value={treatmentDoctorName}
                  onChange={(e) => setTreatmentDoctorName(e.target.value)}
                  placeholder="پزشکی که درمان را انجام داد"
                />
              </div>
              <JalaliDatePicker
                label="تاریخ درمان"
                value={treatmentDate}
                onChange={setTreatmentDate}
              />
              <div className="grid gap-1.5">
                <Label htmlFor="refernote" className="text-xs text-muted-foreground">
                  علت ارجاع
                </Label>
                <Input
                  id="refernote"
                  value={doctorReferral}
                  onChange={(e) => setDoctorReferral(e.target.value)}
                />
              </div>
            </div>
            <ServicePicker
              label="خدمات گرفته‌شده در درمان ارجاعی"
              catalogue={serviceCatalogue}
              value={treatmentServiceNames}
              onChange={setTreatmentServiceNames}
              emptyHint="هنوز خدمتی ثبت نشده"
            />
          </div>
        )}

        {showAdvanced && (
          <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2">
            <TextArea id="pain" label="درد / ورم" value={painSwelling} onChange={setPainSwelling} />
            <TextArea id="delay" label="تاخیر" value={delayComplaint} onChange={setDelayComplaint} />
            <TextArea id="positive" label="نکته مثبت" value={positiveNote} onChange={setPositiveNote} />
            <TextArea id="summary" label="خلاصه حرف بیمار" value={patientSummary} onChange={setPatientSummary} rows={3} />
            <TextArea id="callcenter" label="ارجاع به کال‌سنتر" value={callCenterReferral} onChange={setCallCenterReferral} />
            <JalaliDatePicker label="تاریخ رضایت‌سنجی مجدد" value={resurveyDate} onChange={setResurveyDate} />
            <TextArea id="resurvey" label="نتیجه رضایت‌سنجی مجدد" value={resurveyResult} onChange={setResurveyResult} />
          </div>
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>انصراف</Button>
        <Button onClick={handleSubmit} disabled={saving || !contactDate}>
          {saving ? <><Loader2 className="size-4 animate-spin" /> در حال ذخیره…</> : contact ? "ذخیره تغییرات" : "ثبت تماس"}
        </Button>
      </DialogFooter>
    </>
  )
}
