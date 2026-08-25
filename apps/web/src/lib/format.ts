const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹"

/** Latin digits → Persian digits, leaving separators and letters untouched. */
export function toPersianNum(value: number | string): string {
  return value.toString().replace(/\d/g, (d) => PERSIAN_DIGITS[Number(d)]!)
}

export function formatCount(value: number): string {
  return toPersianNum(value.toLocaleString("en-US"))
}

/**
 * Rial amounts routinely reach 11 digits (a single reception can exceed
 * ۱۰۰٬۰۰۰٬۰۰۰), so full numbers are unreadable in a table cell or on an axis.
 * Scale to میلیون/میلیارد and keep one decimal.
 */
export function formatRial(value: number, opts: { withUnit?: boolean } = {}): string {
  const withUnit = opts.withUnit ?? true
  const abs = Math.abs(value)

  if (abs >= 1_000_000_000) {
    const scaled = (value / 1_000_000_000).toFixed(abs >= 10_000_000_000 ? 0 : 1)
    return `${toPersianNum(stripTrailingZero(scaled))}${withUnit ? " میلیارد" : ""}`
  }
  if (abs >= 1_000_000) {
    const scaled = (value / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)
    return `${toPersianNum(stripTrailingZero(scaled))}${withUnit ? " میلیون" : ""}`
  }
  return toPersianNum(Math.round(value).toLocaleString("en-US"))
}

function stripTrailingZero(value: string): string {
  return value.endsWith(".0") ? value.slice(0, -2) : value
}

/** Exact amount with thousands separators — for tooltips and detail views. */
export function formatRialExact(value: number): string {
  return `${toPersianNum(Math.round(value).toLocaleString("en-US"))} ریال`
}

export function formatPercent(ratio: number, digits = 1): string {
  return `${toPersianNum((ratio * 100).toFixed(digits))}٪`
}

const MONTH_NAMES: Record<string, string> = {
  "01": "فروردین", "02": "اردیبهشت", "03": "خرداد",
  "04": "تیر", "05": "مرداد", "06": "شهریور",
  "07": "مهر", "08": "آبان", "09": "آذر",
  "10": "دی", "11": "بهمن", "12": "اسفند",
}

/** `1405/05` → «مرداد ۱۴۰۵»; `1405/05/19` → «۱۹ مرداد ۱۴۰۵`; `1405` → «۱۴۰۵». */
export function formatJalaliPeriod(period: string): string {
  const parts = period.split("/")
  if (parts.length === 1) return toPersianNum(parts[0]!)
  if (parts.length === 2) {
    return `${MONTH_NAMES[parts[1]!] ?? parts[1]} ${toPersianNum(parts[0]!)}`
  }
  return `${toPersianNum(parts[2]!)} ${MONTH_NAMES[parts[1]!] ?? parts[1]} ${toPersianNum(parts[0]!)}`
}

/** Relative wording for RFM recency, which is what makes it actionable. */
export function formatRecency(days: number | null): string {
  if (days === null) return "—"
  if (days === 0) return "امروز"
  if (days < 30) return `${toPersianNum(days)} روز پیش`
  if (days < 365) return `${toPersianNum(Math.round(days / 30))} ماه پیش`
  const years = (days / 365).toFixed(1)
  return `${toPersianNum(stripTrailingZero(years))} سال پیش`
}
