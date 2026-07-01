import DateObject from "react-date-object";
import persian from "react-date-object/calendars/persian";
import persian_fa from "react-date-object/locales/persian_fa";
import gregorian from "react-date-object/calendars/gregorian";

/** Convert Jalali YYYY/MM/DD (+ optional HH:mm) to ISO string. */
export function jalaliToIso(jalaliDate: string, time?: string): string {
  const parts = jalaliDate.split("/").map((p) => parseInt(p, 10));
  if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) {
    throw new Error("فرمت تاریخ شمسی نامعتبر است");
  }

  const [year, month, day] = parts as [number, number, number];
  const date = new DateObject({ year, month, day, calendar: persian });
  const g = date.convert(gregorian);
  const isoDate = `${g.year}-${String(g.month.number).padStart(2, "0")}-${String(g.day).padStart(2, "0")}`;

  if (time) {
    return new Date(`${isoDate}T${time}:00`).toISOString();
  }
  return isoDate;
}

/** Convert ISO / Date to Jalali YYYY/MM/DD. */
export function isoToJalali(value: string | Date | null | undefined): string {
  if (!value) return "";
  try {
    const date = new DateObject(value);
    date.convert(persian);
    return date.format("YYYY/MM/DD");
  } catch {
    return "";
  }
}

/** Format Jalali date string for display with Persian digits. */
export function formatJalaliDisplay(jalaliDate: string | null | undefined): string {
  if (!jalaliDate) return "---";
  return jalaliDate.replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[parseInt(d, 10)]!);
}

/** Add days to today in Jalali calendar. */
export function offsetJalaliDate(days: number): string {
  const date = new DateObject({ calendar: persian });
  if (days !== 0) date.add(days, "day");
  return date.format("YYYY/MM/DD");
}

/** Today's date in Jalali YYYY/MM/DD. */
export function todayJalali(): string {
  return offsetJalaliDate(0);
}

/** First day of current Jalali year YYYY/01/01. */
export function startOfJalaliYear(): string {
  const date = new DateObject({ calendar: persian });
  return `${date.year}/01/01`;
}
