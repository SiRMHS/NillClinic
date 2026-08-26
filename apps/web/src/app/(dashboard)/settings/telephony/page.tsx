"use client"

import { useEffect, useState } from "react"
import { apiFetch } from "@/lib/api-client"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Phone, PhoneCall, Loader2, Save } from "lucide-react"
import { toast } from "sonner"
import {
  buildDialUrl,
  DEFAULT_TELEPHONY_SETTINGS,
  DIAL_MODE_LABELS,
  DIAL_NUMBER_FORMAT_LABELS,
  dialModeSchema,
  dialNumberFormatSchema,
  type DialMode,
  type DialNumberFormat,
  type TelephonySettings,
} from "@jordan/shared"
import { useTelephony } from "@/stores/telephony.store"

/** What each mode needs from the operator, shown under the selector. */
const MODE_HINTS: Record<DialMode, string> = {
  TEL: "لینک tel: به هر برنامه‌ای می‌رود که سیستم‌عامل به‌عنوان تلفن ثبت کرده — اگر سافت‌فون نصب نباشد هیچ اتفاقی نمی‌افتد.",
  CALLTO: "قدیمی‌تر از tel: ولی بعضی سافت‌فون‌ها فقط این را ثبت می‌کنند.",
  SIP: "برای Issabel/Asterisk با سافت‌فون رجیسترشده (Zoiper، MicroSIP، Bria). لینک به شکل sip:شماره@آدرس PBX ساخته می‌شود.",
  THREECX: "وب‌کلاینت 3CX را در مرورگر باز می‌کند و شماره را در آن می‌گذارد. برای دسکی که فقط 3CX دارد لازم است، چون وب‌کلاینت هندلر tel: ثبت نمی‌کند.",
  CUSTOM: "هر URL دیگری. {number} جای شماره قرار می‌گیرد.",
}

const SAMPLE_NUMBER = "09121234567"

export default function TelephonySettingsPage() {
  const applySettings = useTelephony((s) => s.set)
  const [settings, setSettings] = useState<TelephonySettings>(DEFAULT_TELEPHONY_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testNumber, setTestNumber] = useState(SAMPLE_NUMBER)

  useEffect(() => {
    apiFetch<TelephonySettings>("/api/telephony")
      .then(setSettings)
      .catch(() => toast.error("خطا در بارگذاری تنظیمات"))
      .finally(() => setLoading(false))
  }, [])

  const update = <K extends keyof TelephonySettings>(key: K, value: TelephonySettings[K]) =>
    setSettings((prev) => ({ ...prev, [key]: value }))

  const save = async () => {
    setSaving(true)
    try {
      const saved = await apiFetch<TelephonySettings>("/api/telephony", {
        method: "PUT",
        body: JSON.stringify(settings),
      })
      setSettings(saved)
      // Push into the store so the dial buttons pick the change up without a
      // reload — the store only fetches once per session.
      applySettings(saved)
      toast.success("تنظیمات تماس ذخیره شد")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "خطا در ذخیره تنظیمات")
    } finally {
      setSaving(false)
    }
  }

  const preview = buildDialUrl(testNumber, settings)
  const needsHost = settings.dialMode === "SIP" || settings.dialMode === "THREECX"
  const invalid =
    (needsHost && !settings.pbxHost?.trim()) ||
    (settings.dialMode === "CUSTOM" && !settings.linkTemplate?.includes("{number}"))

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">تنظیمات تلفن</h1>
        <p className="text-sm text-muted-foreground mt-1">
          تعیین می‌کند دکمه «تماس» روی لیدها شماره را به کدام سیستم تلفنی بدهد
        </p>
      </div>

      {loading ? (
        <Skeleton className="h-96 w-full rounded-xl" />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Phone className="size-4 text-violet-600" />
                نحوه شماره‌گیری
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>نوع لینک تماس</Label>
                <Select
                  value={settings.dialMode}
                  onValueChange={(v) => update("dialMode", dialModeSchema.parse(v))}
                >
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {dialModeSchema.options.map((mode) => (
                      <SelectItem key={mode} value={mode}>{DIAL_MODE_LABELS[mode]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground leading-relaxed">{MODE_HINTS[settings.dialMode]}</p>
              </div>

              {needsHost && (
                <div className="space-y-2">
                  <Label>آدرس PBX</Label>
                  <Input
                    dir="ltr"
                    placeholder={settings.dialMode === "SIP" ? "pbx.clinic.ir" : "3cx.clinic.ir:5001"}
                    value={settings.pbxHost ?? ""}
                    onChange={(e) => update("pbxHost", e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">فقط دامنه یا IP — بدون https:// و بدون مسیر.</p>
                </div>
              )}

              {settings.dialMode === "CUSTOM" && (
                <div className="space-y-2">
                  <Label>الگوی لینک</Label>
                  <Input
                    dir="ltr"
                    placeholder="myphone://call/{number}"
                    value={settings.linkTemplate ?? ""}
                    onChange={(e) => update("linkTemplate", e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">حتماً باید شامل <code className="bg-muted px-1 rounded">{"{number}"}</code> باشد.</p>
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>قالب شماره</Label>
                  <Select
                    value={settings.numberFormat}
                    onValueChange={(v) => update("numberFormat", dialNumberFormatSchema.parse(v) as DialNumberFormat)}
                  >
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {dialNumberFormatSchema.options.map((f) => (
                        <SelectItem key={f} value={f}>{DIAL_NUMBER_FORMAT_LABELS[f]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>کد کشور</Label>
                  <Input
                    dir="ltr"
                    inputMode="numeric"
                    placeholder="98"
                    value={settings.countryCode}
                    onChange={(e) => update("countryCode", e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>پیش‌شماره خط بیرون (اختیاری)</Label>
                <Input
                  dir="ltr"
                  inputMode="numeric"
                  placeholder="9"
                  value={settings.dialPrefix}
                  onChange={(e) => update("dialPrefix", e.target.value)}
                />
                <p className="text-xs text-muted-foreground">اگر مرکز تلفن برای خط بیرون رقمی می‌خواهد (مثلاً ۹)، اینجا بگذارید.</p>
              </div>

              <Button onClick={save} disabled={saving || invalid} className="gap-2">
                {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                ذخیره
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <PhoneCall className="size-4 text-emerald-600" />
                آزمایش
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>شماره نمونه</Label>
                <Input
                  dir="ltr"
                  value={testNumber}
                  onChange={(e) => setTestNumber(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label>لینکی که دکمه تماس باز می‌کند</Label>
                <div className="rounded-lg border bg-muted/30 p-3">
                  <code className="text-xs font-mono break-all" dir="ltr">
                    {preview ?? "— شماره معتبر نیست —"}
                  </code>
                </div>
                <p className="text-xs text-muted-foreground">
                  این پیش‌نمایش از همان تنظیمات بالا ساخته می‌شود، حتی قبل از ذخیره.
                </p>
              </div>

              {preview && (
                <Button variant="outline" className="gap-2" render={<a href={preview} />}>
                  <PhoneCall className="size-4" />
                  اجرای آزمایشی
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
