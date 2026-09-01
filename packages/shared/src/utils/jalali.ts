/**
 * Jalali (Shamsi) ↔ Gregorian conversion.
 *
 * The Jordan CRM speaks Jalali `YYYY/MM/DD` everywhere — it silently returns an
 * empty array for Gregorian `fromdate`/`todate` rather than erroring — while the
 * dashboard needs real Date values for period filtering and recency maths.
 *
 * Implements the standard Birashk-corrected algorithm used by jalaali-js (MIT,
 * Behrang Norouzinia), which is exact for Jalali years 1178–1633. Pure and
 * dependency-free so it is safe to import from the browser bundle too.
 */

const div = (a: number, b: number): number => Math.trunc(a / b);
const mod = (a: number, b: number): number => a - Math.trunc(a / b) * b;

/** Years at which the 33-year leap cycle shifts. */
const BREAKS = [
  -61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192,
  2262, 2324, 2394, 2456, 3178,
];

export interface JalaliParts {
  jy: number;
  jm: number;
  jd: number;
}

function jalCal(jy: number): { leap: number; gy: number; march: number } {
  const bl = BREAKS.length;
  const gy = jy + 621;
  let leapJ = -14;
  // BREAKS is a fixed non-empty literal, so these indexes always resolve;
  // the assertions only satisfy noUncheckedIndexedAccess.
  let jp = BREAKS[0]!;

  if (jy < jp || jy >= BREAKS[bl - 1]!) {
    throw new RangeError(`Jalaali year out of range: ${jy}`);
  }

  let jump = 0;
  for (let i = 1; i < bl; i += 1) {
    const jm = BREAKS[i]!;
    jump = jm - jp;
    if (jy < jm) break;
    leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }
  let n = jy - jp;

  leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;

  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;

  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  let leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;

  return { leap, gy, march };
}

/** Gregorian date → Julian Day Number. */
function g2d(gy: number, gm: number, gd: number): number {
  let d =
    div((gy + div(gm - 8, 6) + 100100) * 1461, 4) +
    div(153 * mod(gm + 9, 12) + 2, 5) +
    gd -
    34840408;
  d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  return d;
}

/** Julian Day Number → Gregorian date. */
function d2g(jdn: number): { gy: number; gm: number; gd: number } {
  let j = 4 * jdn + 139361631;
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const gd = div(mod(i, 153), 5) + 1;
  const gm = mod(div(i, 153), 12) + 1;
  const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { gy, gm, gd };
}

/** Jalali date → Julian Day Number. */
function j2d(jy: number, jm: number, jd: number): number {
  const r = jalCal(jy);
  return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
}

/** Julian Day Number → Jalali date. */
function d2j(jdn: number): JalaliParts {
  const gy = d2g(jdn).gy;
  let jy = gy - 621;
  const r = jalCal(jy);
  const jdn1f = g2d(gy, 3, r.march);
  let k = jdn - jdn1f;

  if (k >= 0) {
    if (k <= 185) {
      return { jy, jm: 1 + div(k, 31), jd: mod(k, 31) + 1 };
    }
    k -= 186;
  } else {
    jy -= 1;
    k += 179;
    if (r.leap === 1) k += 1;
  }
  return { jy, jm: 7 + div(k, 30), jd: mod(k, 30) + 1 };
}

const JALALI_RE = /^(\d{3,4})[/-](\d{1,2})[/-](\d{1,2})$/;

/**
 * Persian (U+06F0–U+06F9) and Arabic-Indic (U+0660–U+0669) digits → ASCII.
 *
 * Every Persian-locale date picker renders — and therefore emits — Persian
 * numerals, while JavaScript's `\d` matches ASCII only. Without this, a value
 * the UI itself produced (`۱۴۰۵/۰۵/۲۱`) fails its own validation.
 */
export function toLatinDigits(value: string): string {
  return value.replace(/[۰-۹٠-٩]/g, (d) => {
    const code = d.charCodeAt(0);
    const base = code >= 0x06f0 ? 0x06f0 : 0x0660;
    return String(code - base);
  });
}

/**
 * Parse a CRM Jalali string. Returns null for the many blank-ish values the CRM
 * emits (`""`, `" "`, `"0000/00/00"`) rather than throwing, so one bad date
 * never costs us the surrounding record.
 */
export function parseJalali(value: string | null | undefined): JalaliParts | null {
  if (!value) return null;
  const m = JALALI_RE.exec(toLatinDigits(value.trim()));
  if (!m) return null;
  const jy = Number(m[1]);
  const jm = Number(m[2]);
  const jd = Number(m[3]);
  if (jy < 1178 || jy > 1633) return null;
  if (jm < 1 || jm > 12) return null;
  if (jd < 1 || jd > 31) return null;
  return { jy, jm, jd };
}

/** Jalali string → UTC Date at midnight, or null if unparseable. */
export function jalaliToDate(value: string | null | undefined): Date | null {
  const p = parseJalali(value);
  if (!p) return null;
  const { gy, gm, gd } = d2g(j2d(p.jy, p.jm, p.jd));
  return new Date(Date.UTC(gy, gm - 1, gd));
}

const pad = (n: number): string => String(n).padStart(2, "0");

/** Date → Jalali `YYYY/MM/DD`. */
export function dateToJalali(date: Date): string {
  const jdn = g2d(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  const { jy, jm, jd } = d2j(jdn);
  return `${jy}/${pad(jm)}/${pad(jd)}`;
}

export function formatJalali(p: JalaliParts): string {
  return `${p.jy}/${pad(p.jm)}/${pad(p.jd)}`;
}

/**
 * Jalali → `YYYY-MM-DD` for writing straight into a SQL `timestamp` column.
 *
 * Prefer this over `jalaliToDate` for persistence. Handing the driver a JS Date
 * makes it serialize in the process timezone, so a midnight-UTC Date becomes
 * `03:30` in Tehran — and, on any host west of UTC, rolls back to the *previous
 * day*, quietly moving receptions between days and corrupting daily revenue.
 * A bare date string cast to `::timestamp` carries no timezone at all.
 */
export function jalaliToSqlDate(value: string | null | undefined): string | null {
  const p = parseJalali(value);
  if (!p) return null;
  const { gy, gm, gd } = d2g(j2d(p.jy, p.jm, p.jd));
  return `${gy}-${pad(gm)}-${pad(gd)}`;
}

/** Today in Jalali. */
export function jalaliToday(now: Date = new Date()): string {
  return dateToJalali(now);
}

/**
 * The Jalali year `date` falls in, as an inclusive `from`/`to` range.
 *
 * "This year" is a Jalali year here, not a Gregorian one — the clinic's books,
 * targets and every date on screen run فروردین to اسفند, so a range built on
 * the Gregorian year would start in the middle of دی and read as wrong to
 * everyone using it. The end is 12/30 rather than 12/29 so a leap year is
 * covered; the extra day in an ordinary year matches nothing and is harmless.
 */
export function jalaliYearRange(date: string = jalaliToday()): { from: string; to: string } {
  const p = parseJalali(date);
  const year = p ? p.jy : Number(jalaliToday().slice(0, 4));
  return { from: `${year}/01/01`, to: `${year}/12/30` };
}

/** Shift a Jalali date by whole days, staying in Jalali. */
export function addJalaliDays(value: string, days: number): string {
  const p = parseJalali(value);
  if (!p) throw new RangeError(`Unparseable Jalali date: ${value}`);
  return formatJalali(d2j(j2d(p.jy, p.jm, p.jd) + days));
}

/** Whole days from `a` to `b` (negative if b precedes a); null if either is bad. */
export function jalaliDiffDays(a: string, b: string): number | null {
  const pa = parseJalali(a);
  const pb = parseJalali(b);
  if (!pa || !pb) return null;
  return j2d(pb.jy, pb.jm, pb.jd) - j2d(pa.jy, pa.jm, pa.jd);
}

export interface JalaliWindow {
  from: string;
  to: string;
}

/**
 * Split a Jalali range into inclusive windows of at most `days` each.
 *
 * Needed because `Treatment/GetTreatments` ignores pageNumber/pageSize entirely
 * (page 1 and page 2 return byte-identical payloads), so the only way to walk it
 * is to narrow the date range until each response is a manageable size.
 */
export function jalaliWindows(from: string, to: string, days: number): JalaliWindow[] {
  if (days < 1) throw new RangeError("window size must be >= 1 day");
  const total = jalaliDiffDays(from, to);
  if (total === null) throw new RangeError(`Unparseable Jalali range: ${from}..${to}`);
  if (total < 0) return [];

  const windows: JalaliWindow[] = [];
  let cursor = from;
  for (let offset = 0; offset <= total; offset += days) {
    const remaining = total - offset;
    const span = Math.min(days - 1, remaining);
    windows.push({ from: cursor, to: addJalaliDays(cursor, span) });
    cursor = addJalaliDays(cursor, span + 1);
  }
  return windows;
}
