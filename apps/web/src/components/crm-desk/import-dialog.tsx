"use client"

import { useRef, useState } from "react"
import { AlertTriangle, CheckCircle2, FileUp, Loader2, Upload } from "lucide-react"
import { toast } from "sonner"
import { apiDownload, apiFetch } from "@/lib/api-client"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { toPersianNum } from "@/lib/format"
import { cn } from "@/lib/utils"

interface ImportIssue {
  column: string
  message: string
}

interface ImportRow {
  line: number
  data: unknown
  errors: ImportIssue[]
  warnings: ImportIssue[]
}

interface ImportPreview {
  rows: ImportRow[]
  summary: { total: number; valid: number; invalid: number; warnings: number }
  unknownColumns: string[]
}

interface CommitResult {
  imported: number
  skipped?: number
  doctors?: number
}

export type ImportKind = "contacts" | "schedule"

const COPY: Record<ImportKind, { title: string; description: string; unit: string }> = {
  contacts: {
    title: "ورود تماس‌های CRM از فایل",
    description:
      "فایل باید همان ستون‌های خروجی اکسل این صفحه را داشته باشد. ستون «تاریخ تماس» الزامی است؛ ستون‌های محاسباتی مثل رضایت کلی و ریسک ریزش از روی امتیازها دوباره حساب می‌شوند و مقدارشان در فایل نادیده گرفته می‌شود.",
    unit: "تماس",
  },
  schedule: {
    title: "ورود برنامه هفتگی پزشکان از فایل",
    description:
      "فایل به شکل جدول است: یک سطر برای هر پزشک و یک ستون برای هر روز هفته. هر خانه‌ای که پر باشد به‌عنوان شیفت آن روز ثبت می‌شود.",
    unit: "پزشک",
  },
}

/**
 * Upload, look, then commit.
 *
 * A CRM row carries a patient's name, mobile and what they paid, so an import
 * that writes the moment a file is chosen gives the operator no chance to spot
 * that Excel mangled a column or that they picked last month's file. The
 * preview is a parse with no writes; the commit sends the same text back and
 * the server parses it again, so the browser never gets to decide what is
 * stored.
 */
export function ImportDialog({
  kind,
  open,
  onOpenChange,
  onImported,
}: {
  kind: ImportKind
  open: boolean
  onOpenChange: (open: boolean) => void
  onImported: () => void
}) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [csv, setCsv] = useState<string | null>(null)
  const [fileName, setFileName] = useState("")
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [mode, setMode] = useState<"merge" | "replace">("merge")
  const [busy, setBusy] = useState(false)

  const copy = COPY[kind]

  const reset = () => {
    setCsv(null)
    setFileName("")
    setPreview(null)
    setBusy(false)
    if (fileInput.current) fileInput.current.value = ""
  }

  const close = (next: boolean) => {
    if (!next) reset()
    onOpenChange(next)
  }

  const choose = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    try {
      // Read as text in the browser and send as JSON: the API already parses
      // JSON bodies and enforces CSRF on them, and a multipart upload would
      // need a second code path through both.
      const text = await file.text()
      setCsv(text)
      setFileName(file.name)
      const result = await apiFetch<ImportPreview>(`/api/crm-desk/import/${kind}/preview`, {
        method: "POST",
        body: JSON.stringify({ csv: text }),
      })
      setPreview(result)
    } catch (err) {
      reset()
      toast.error(err instanceof Error ? err.message : "فایل خوانده نشد")
    } finally {
      setBusy(false)
    }
  }

  const commit = async () => {
    if (!csv) return
    setBusy(true)
    try {
      const result = await apiFetch<CommitResult>(`/api/crm-desk/import/${kind}/commit`, {
        method: "POST",
        body: JSON.stringify(kind === "schedule" ? { csv, mode } : { csv }),
      })
      toast.success(
        `${toPersianNum(result.doctors ?? result.imported)} ${copy.unit} ثبت شد` +
          (result.skipped ? ` — ${toPersianNum(result.skipped)} سطر به دلیل خطا رد شد` : ""),
      )
      onImported()
      close(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "خطا در ثبت فایل")
    } finally {
      setBusy(false)
    }
  }

  const downloadTemplate = async () => {
    try {
      await apiDownload(`/api/crm-desk/import/${kind}/template`, "قالب.csv")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "خطا در دریافت قالب")
    }
  }

  const problems = preview?.rows.filter((r) => r.errors.length > 0 || r.warnings.length > 0) ?? []

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription className="leading-relaxed">{copy.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => void choose(e.target.files?.[0])}
            />
            <Button variant="outline" disabled={busy} onClick={() => fileInput.current?.click()}>
              <FileUp className="size-4" /> انتخاب فایل CSV
            </Button>
            <Button variant="ghost" onClick={() => void downloadTemplate()}>
              دریافت قالب نمونه
            </Button>
            {fileName && <span className="text-xs text-muted-foreground">{fileName}</span>}
            {busy && !preview && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
          </div>

          {kind === "schedule" && preview && (
            <div className="grid gap-1.5">
              <Label className="text-xs text-muted-foreground">نحوه اعمال</Label>
              <Select value={mode} onValueChange={(v) => setMode(v as "merge" | "replace")}>
                <SelectTrigger className="w-72"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="merge">فقط پزشکان داخل فایل به‌روز شوند</SelectItem>
                  <SelectItem value="replace">کل برنامه با این فایل جایگزین شود</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {preview && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2 text-center">
                <Summary label="سطر قابل ثبت" value={preview.summary.valid} tone="positive" />
                <Summary label="سطر دارای خطا" value={preview.summary.invalid} tone={preview.summary.invalid ? "danger" : undefined} />
                <Summary label="سطر با هشدار" value={preview.summary.warnings} tone={preview.summary.warnings ? "warning" : undefined} />
              </div>

              {preview.unknownColumns.length > 0 && (
                <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs leading-relaxed">
                  این ستون‌ها شناخته نشدند و نادیده گرفته می‌شوند: {preview.unknownColumns.join("، ")}
                </p>
              )}

              {problems.length > 0 ? (
                <div className="max-h-64 overflow-y-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-20">سطر</TableHead>
                        <TableHead className="w-40">ستون</TableHead>
                        <TableHead>پیام</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {problems.slice(0, 100).flatMap((row) =>
                        [
                          ...row.errors.map((issue) => ({ row, issue, fatal: true })),
                          ...row.warnings.map((issue) => ({ row, issue, fatal: false })),
                        ].map(({ issue, fatal }, i) => (
                          <TableRow key={`${row.line}-${i}`}>
                            <TableCell className="tabular-nums">{toPersianNum(row.line)}</TableCell>
                            <TableCell className="text-xs">{issue.column || "—"}</TableCell>
                            <TableCell
                              className={cn(
                                "text-xs",
                                fatal ? "text-rose-600 dark:text-rose-400" : "text-amber-600 dark:text-amber-400",
                              )}
                            >
                              {fatal ? "خطا: " : "هشدار: "}
                              {issue.message}
                            </TableCell>
                          </TableRow>
                        )),
                      )}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <p className="flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs">
                  <CheckCircle2 className="size-4 text-emerald-600" />
                  همه سطرها بدون خطا خوانده شدند.
                </p>
              )}

              {preview.summary.invalid > 0 && (
                <p className="flex items-start gap-2 text-xs text-muted-foreground">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
                  سطرهای دارای خطا ثبت نمی‌شوند؛ بقیه سطرها ثبت می‌شوند. اگر می‌خواهید همه سطرها وارد شوند،
                  فایل را اصلاح کنید و دوباره بارگذاری کنید.
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)} disabled={busy}>
            انصراف
          </Button>
          <Button onClick={() => void commit()} disabled={busy || !preview || preview.summary.valid === 0}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            ثبت {preview ? toPersianNum(preview.summary.valid) : ""} سطر
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Summary({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone?: "positive" | "warning" | "danger"
}) {
  return (
    <div
      className={cn(
        "rounded-lg border p-3",
        tone === "positive" && "border-emerald-500/40 bg-emerald-500/10",
        tone === "warning" && "border-amber-500/40 bg-amber-500/10",
        tone === "danger" && "border-rose-500/40 bg-rose-500/10",
      )}
    >
      <div className="text-lg font-semibold tabular-nums">{toPersianNum(value)}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  )
}
