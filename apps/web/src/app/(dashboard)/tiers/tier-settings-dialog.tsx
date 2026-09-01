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
import { rialToToman, tomanToRial, type PatientTier } from "@jordan/shared"
import { toast } from "sonner"

interface TierSettings {
  platinumMin: number
  goldMin: number
  silverMin: number
  bronzeMin: number
  updatedAt: string | null
}

type Threshold = "platinumMin" | "goldMin" | "silverMin" | "bronzeMin"

const THRESHOLDS: { field: Threshold; tier: PatientTier }[] = [
  { field: "platinumMin", tier: "PLATINUM" },
  { field: "goldMin", tier: "GOLD" },
  { field: "silverMin", tier: "SILVER" },
  { field: "bronzeMin", tier: "BRONZE" },
]

const EMPTY_FORM: Record<Threshold, string> = {
  platinumMin: "",
  goldMin: "",
  silverMin: "",
  bronzeMin: "",
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
  /**
   * Held in Toman, stored in Rial.
   *
   * The clinic states these bands in Toman ("بالای ۱ میلیارد تومان پلاتینیوم"),
   * every amount in the database is Rial, and a threshold typed one zero out is
   * invisible until a whole tier empties. The form therefore converts on both
   * edges and never asks anyone to do it in their head.
   */
  const [form, setForm] = useState<Record<Threshold, string>>(EMPTY_FORM)
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
          platinumMin: String(rialToToman(s.platinumMin)),
          goldMin: String(rialToToman(s.goldMin)),
          silverMin: String(rialToToman(s.silverMin)),
          bronzeMin: String(rialToToman(s.bronzeMin)),
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
    platinumMin: tomanToRial(Number(form.platinumMin)),
    goldMin: tomanToRial(Number(form.goldMin)),
    silverMin: tomanToRial(Number(form.silverMin)),
    bronzeMin: tomanToRial(Number(form.bronzeMin)),
  }
  // Mirrors the server's refinement so the error appears before the round trip.
  const valid =
    THRESHOLDS.every(({ field }) => form[field] !== "" && Number.isFinite(parsed[field])) &&
    parsed.platinumMin > parsed.goldMin &&
    parsed.goldMin > parsed.silverMin &&
    parsed.silverMin > parsed.bronzeMin &&
    parsed.bronzeMin > 0

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
            حداقل مجموع پرداختی <strong>به تومان</strong> برای هر رتبه. خاکستری یعنی کمتر از آستانه
            برنز. رتبه بیمارانی که دستی VIP یا سلبریتی شده‌اند مستقل از این اعداد پلاتینیوم می‌ماند.
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
            {THRESHOLDS.map(({ field, tier }) => (
              <div key={field} className="space-y-1.5">
                <Label htmlFor={field} className="flex items-center gap-2">
                  <TierBadge tier={tier} />
                  <span className="text-xs text-muted-foreground">از این مبلغ به بالا (تومان)</span>
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
                {/* Both units, because the tables elsewhere read in Rial. */}
                <p className="text-xs text-muted-foreground">
                  {form[field] && Number.isFinite(Number(form[field]))
                    ? `${formatRial(Number(form[field]), { withUnit: true })} تومان — معادل ${formatRial(parsed[field])} ریال`
                    : "—"}
                </p>
              </div>
            ))}

            {!valid ? (
              <p className="text-xs text-rose-600 dark:text-rose-400">
                آستانه‌ها باید نزولی و بزرگ‌تر از صفر باشند: پلاتینیوم بیشتر از طلایی، طلایی بیشتر
                از نقره‌ای، نقره‌ای بیشتر از برنز.
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
