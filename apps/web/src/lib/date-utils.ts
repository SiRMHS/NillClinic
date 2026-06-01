function toPersianDigits(s: string): string {
  return s.replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[parseInt(d, 10)])
}

function fromPersianDigits(s: string): string {
  return s.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
}

function isPersianDate(str: string): boolean {
  return /^\d{4}\/\d{2}\/\d{2}$/.test(str)
}

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "---"
  if (isPersianDate(dateStr)) return toPersianDigits(dateStr)
  try {
    const date = new Date(dateStr)
    if (isNaN(date.getTime())) return dateStr
    return new Intl.DateTimeFormat("fa-IR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date)
  } catch {
    return dateStr
  }
}

export function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "---"
  if (isPersianDate(dateStr)) return toPersianDigits(dateStr)
  try {
    const date = new Date(dateStr)
    if (isNaN(date.getTime())) return dateStr
    return new Intl.DateTimeFormat("fa-IR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date)
  } catch {
    return dateStr
  }
}

export function calculateAge(birthDateStr: string | null | undefined): number | null {
  if (!birthDateStr || !isPersianDate(birthDateStr)) return null
  const [bYear, bMonth, bDay] = birthDateStr.split("/").map(Number)
  if (!bYear || !bMonth || !bDay) return null
  const formatter = new Intl.DateTimeFormat("fa-IR", {
    year: "numeric", month: "2-digit", day: "2-digit",
  })
  const parts = formatter.formatToParts(new Date())
  const tYear = parseInt(fromPersianDigits(parts.find((p) => p.type === "year")!.value))
  const tMonth = parseInt(fromPersianDigits(parts.find((p) => p.type === "month")!.value))
  const tDay = parseInt(fromPersianDigits(parts.find((p) => p.type === "day")!.value))
  let age = tYear - bYear
  if (tMonth < bMonth || (tMonth === bMonth && tDay < bDay)) age--
  return age
}
