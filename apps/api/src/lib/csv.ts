import type { Response } from "express";

/**
 * CSV generation for the report exports.
 *
 * Excel is the destination for every one of these files, which constrains the
 * output in two ways that plain RFC 4180 does not cover:
 *
 *   • **BOM.** Without a UTF-8 byte-order mark, Excel on Windows decodes the
 *     file in the system codepage and every Persian column arrives as mojibake.
 *     The three-byte prefix is the whole fix.
 *
 *   • **Formula injection.** A cell whose text begins with `=`, `+`, `-` or `@`
 *     is evaluated as a formula when the file is opened. Patient names come
 *     from an external CRM, so a value like `=HYPERLINK(...)` would execute on
 *     the clinic's machine. Such cells are prefixed with a tab, which Excel
 *     treats as text and does not display.
 */

const BOM = "\uFEFF";

/** Characters Excel treats as the start of a formula. */
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return "";

  // Numbers skip the formula guard. This report set carries negative amounts
  // (refunds), and `-5` matches the leading-`-` rule — prefixing it with a tab
  // turned a real figure into text that Excel would not sum.
  if (typeof value === "number" || typeof value === "bigint") return String(value);

  let text = typeof value === "string" ? value : String(value);

  if (FORMULA_PREFIX.test(text)) text = `\t${text}`;

  // Quote only when required, so numeric columns stay numeric in Excel.
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => unknown;
}

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const lines = [columns.map((c) => escapeCsvCell(c.header)).join(",")];
  for (const row of rows) {
    lines.push(columns.map((c) => escapeCsvCell(c.value(row))).join(","));
  }
  // CRLF is what Excel expects; a bare LF makes older versions run rows together.
  return BOM + lines.join("\r\n") + "\r\n";
}

/**
 * Send a CSV as a download.
 *
 * The filename is sent twice: a plain ASCII `filename` for old clients and an
 * RFC 5987 `filename*` carrying the real Persian name. Sending only the Persian
 * form makes the header invalid, and browsers then fall back to the URL path,
 * which produces a file called `export`.
 */
export function sendCsv(res: Response, filename: string, csv: string): void {
  const ascii = filename.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
  );
  res.send(csv);
}

/** `گزارش-پزشکان-1405-05-22.csv` — Jalali-stamped so exports self-describe. */
export function stampedFilename(prefix: string, jalaliDate: string): string {
  return `${prefix}-${jalaliDate.replace(/\//g, "-")}.csv`;
}
