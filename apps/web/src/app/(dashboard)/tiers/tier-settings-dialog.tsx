"use client"

import { useEffect, useState } from "react"
import { apiFetch } from "@/lib/api-client"
import { formatRial, toPersianNum } from "@/lib/format"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { TierBadge } from "@/components/tier-badge"
import { toast } from "sonner"

interface TierSettings {
  platinumMin: number
  goldMin: number
  silverMin: number
  updatedAt: string | null
}

/**
 * Editor for the rial thresholds that define the tiers.
 *
 * Saving re-tiers every patient server-side, which takes a few seconds on this
 * dataset — so the button reports progress rather than appearing to hang.
 */
export function TierSettingsDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const [settings, setSettings] = useState<TierSettings | null>(null)
  const [form, setForm] = useState({ platinumMin: "", goldMin: "", silverMin: "" })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void (async () => {
      try {
        const s = await apiFetch<TierSettings>("/api/reports/tiers/settings")
        if (cancelled) return
        setSettings(s)
        setForm({
          platinumMin: String(s.platinumMin),
          goldMin: String(s.goldMin),
          silverMin: String(s.silverMin),
        })
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "خطا در دریافت آستانه‌ها")
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open])

  const parsed = {
    platinumMin: Number(form.platinumMin),
    goldMin: Number(form.goldMin),
    silverMin: Number(form.silverMin),
  }
  // Mirrors the server's refinement so the error appears before the round trip.
  const valid =
    Number.isFinite(parsed.platinumMin) &&
    Number.isFinite(parsed.goldMin) &&
    Number.isFinite(parsed.silverMin) &&
    parsed.platinumMin > parsed.goldMin &&
    parsed.goldMin > parsed.silverMin &&
    parsed.silverMin > 0

  const save = async () => {
    setSaving(true)
    try {
      const result = await apiFetch<{
        settings: TierSettings
        recompute: { patients: number; durationMs: number }
      }>("/api/reports/tiers/settings", {
        method: "PUT",
        body: JSON.stringify(parsed),
      })
      toast.success(
        `آستانه‌ها ذخیره شد و رتبه ${toPersianNum(
          result.recompute.patients.toLocaleString("en-US"),
        )} بیمار بازمحاسبه شد`,
      )
      onSaved()
      onOpenChange(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ذخیره آستانه‌ها ناموفق بود")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="sm:max-w-md">
        <DialogHeader className="text-right">
          <DialogTitle>آستانه‌های رتبه‌بندی</DialogTitle>
          <DialogDescription>
            حداقل مجموع پرداختی (ریال) برای هر رتبه. برنز یعنی بیشتر از صفر و کمتر از آستانه
            نقره‌ای؛ خاکستری یعنی بدون پرداخت.
          </DialogDescription>
        </DialogHeader>

        {settings === null ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : (
          <div className="space-y-4">
            {(
              [
                ["platinumMin", "PLATINUM"],
                ["goldMin", "GOLD"],
                ["silverMin", "SILVER"],
              ] as const
            ).map(([field, tier]) => (
              <div key={field} className="space-y-1.5">
                <Label htmlFor={field} className="flex items-center gap-2">
                  <TierBadge tier={tier} />
                  <span className="text-xs text-muted-foreground">از این مبلغ به بالا</span>
                </Label>
                <Input
                  id={field}
                  inputMode="numeric"
                  value={form[field]}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, [field]: e.target.value.replace(/[^\d]/g, "") }))
                  }
                  className="tabular-nums"
                />
                <p className="text-xs text-muted-foreground">
                  {Number.isFinite(Number(form[field])) && form[field]
                    ? `${formatRial(Number(form[field]))} ریال`
                    : "—"}
                </p>
              </div>
            ))}

            {!valid ? (
              <p className="text-xs text-rose-600 dark:text-rose-400">
                آستانه‌ها باید نزولی و بزرگ‌تر از صفر باشند: پلاتینیوم بیشتر از طلایی، طلایی بیشتر
                از نقره‌ای.
              </p>
            ) : null}

            <p className="text-xs text-muted-foreground">
              با ذخیره، رتبه همه بیماران دوباره محاسبه می‌شود و چند ثانیه طول می‌کشد.
            </p>
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-start">
          <Button onClick={() => void save()} disabled={!valid || saving || settings === null}>
            {saving ? "در حال محاسبه…" : "ذخیره و بازمحاسبه"}
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            انصراف
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
