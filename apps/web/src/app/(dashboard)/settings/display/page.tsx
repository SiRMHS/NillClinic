"use client"

import { useEffect, useState } from "react"
import { EyeOff, Loader2, Save, ShieldCheck } from "lucide-react"
import { toast } from "sonner"
import { DEFAULT_DISPLAY_SETTINGS, type DisplaySettings } from "@jordan/shared"
import { apiFetch } from "@/lib/api-client"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { useDisplay } from "@/stores/display.store"

/** Each switch, with the sentence that says exactly what disappears. */
const SWITCHES: {
  key: keyof DisplaySettings
  label: string
  hint: string
}[] = [
  {
    key: "hideAmounts",
    label: "مخفی کردن همه ارقام مالی در کل سایت",
    hint: "هر مبلغ، درآمد و میانگین مالی در تمام صفحه‌ها به‌جای عدد «———» نمایش داده می‌شود و در خروجی اکسل هم نمی‌آید. ستون‌های غیرمالی مثل تعداد بیمار و امتیاز رضایت دست‌نخورده می‌مانند.",
  },
  {
    key: "hideCrmAmounts",
    label: "مخفی کردن ارقام مالی فقط در بخش CRM",
    hint: "مبلغ دریافتی هر تماس و درآمد پزشکان در میز CRM و تحلیل مراجعین پنهان می‌شود، ولی داشبورد و بخش مالی مثل قبل کار می‌کنند.",
  },
  {
    key: "hideCrmRates",
    label: "مخفی کردن نرخ‌ها و درصدها در بخش CRM",
    hint: "نرخ تبدیل، نرخ بازگشت، نرخ پاسخگویی و نرخ رزرو مجدد نمایش داده نمی‌شوند. امتیاز رضایت و NPS که سنجه کیفیت‌اند باقی می‌مانند.",
  },
]

export default function DisplaySettingsPage() {
  const applySettings = useDisplay((s) => s.set)
  const [settings, setSettings] = useState<DisplaySettings>(DEFAULT_DISPLAY_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    apiFetch<DisplaySettings>("/api/display")
      .then(setSettings)
      .catch(() => toast.error("خطا در بارگذاری تنظیمات نمایش"))
      .finally(() => setLoading(false))
  }, [])

  const save = async () => {
    setSaving(true)
    try {
      const saved = await apiFetch<DisplaySettings>("/api/display", {
        method: "PUT",
        body: JSON.stringify(settings),
      })
      setSettings(saved)
      // Into the store as well, so the change takes hold without a reload —
      // the store only fetches once per session.
      applySettings(saved)
      toast.success("تنظیمات نمایش ذخیره شد")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "خطا در ذخیره تنظیمات")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">تنظیمات نمایش</h1>
        <p className="text-sm text-muted-foreground mt-1">
          تعیین می‌کند چه ارقامی اصلاً روی سایت نشان داده شوند — مستقل از اینکه چه کسی به کدام بخش دسترسی دارد
        </p>
      </div>

      {loading ? (
        <Skeleton className="h-80 w-full rounded-xl" />
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <EyeOff className="size-4 text-violet-600" />
                ارقام پنهان
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {SWITCHES.map(({ key, label, hint }) => (
                <div key={key} className="flex items-start justify-between gap-4 border-b pb-5 last:border-0 last:pb-0">
                  <div className="space-y-1">
                    <Label className="text-sm font-medium">{label}</Label>
                    <p className="text-xs text-muted-foreground leading-relaxed">{hint}</p>
                  </div>
                  <Switch
                    checked={settings[key]}
                    disabled={saving || (key !== "hideAmounts" && settings.hideAmounts)}
                    onCheckedChange={(checked) =>
                      setSettings((prev) => ({ ...prev, [key]: checked }))
                    }
                  />
                </div>
              ))}

              {settings.hideAmounts && (
                <p className="text-xs text-muted-foreground">
                  چون ارقام مالی در کل سایت پنهان است، کلید مخصوص CRM اثر جداگانه‌ای ندارد.
                </p>
              )}

              <Button onClick={save} disabled={saving} className="gap-2">
                {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                ذخیره
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldCheck className="size-4 text-emerald-600" />
                چطور کار می‌کند
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-xs text-muted-foreground leading-relaxed">
              <p>
                ارقام پنهان‌شده فقط روی صفحه محو نمی‌شوند؛ سرور آن‌ها را از پاسخ حذف می‌کند. یعنی
                کاربر حتی از طریق ابزار توسعه‌دهنده مرورگر یا فایل خروجی هم به آن‌ها نمی‌رسد.
              </p>
              <p>
                این تنظیم برای کل سایت است و به <strong>همه کاربران بدون استثنا</strong> اعمال
                می‌شود — مدیر سیستم (دسترسی <code className="bg-muted px-1 rounded">*</code>) هم
                شامل آن است. برای دیدن دوباره ارقام، همین کلید را خاموش کنید.
              </p>
              <p>
                برای اینکه کاربری اصلاً وارد بخشی نشود، به‌جای این صفحه از «مدیریت نقش‌ها» استفاده کنید.
                این کلیدها برای وقتی‌اند که کاربر باید در بخشی کار کند ولی نباید مبالغ آن را ببیند.
              </p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
