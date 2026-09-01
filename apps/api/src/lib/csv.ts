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
  /**
   * This column carries a monetary figure.
   *
   * Marked on the column rather than decided by the caller at the call site, so
   * that «مخفی کردن ارقام مالی» is one flag on `toCsv` instead of a conditional
   * spread around every money column — the shape that let columns be forgotten
   * in the first place.
   */
  money?: boolean;
}

export function toCsv<T>(
  rows: T[],
  columns: CsvColumn<T>[],
  opts: { hideMoney?: boolean } = {},
): string {
  /**
   * Money columns are *dropped*, not blanked.
   *
   * An export is the one place a hidden figure could leave the building, and a
   * header with nothing under it invites someone to go looking for the data
   * that should have been there.
   */
  const visible = opts.hideMoney ? columns.filter((c) => !c.money) : columns;

  const lines = [visible.map((c) => escapeCsvCell(c.header)).join(",")];
  for (const row of rows) {
    lines.push(visible.map((c) => escapeCsvCell(c.value(row))).join(","));
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

/**
 * Parse a CSV upload back into rows.
 *
 * Deliberately narrow: it handles what the exports here produce and what Excel
 * writes when a Persian user saves «ذخیره به صورت CSV UTF-8» — quoted fields,
 * doubled quotes inside them, embedded newlines, CRLF or LF line endings, and a
 * leading BOM. It is not a general CSV engine and does not try to be; anything
 * more exotic belongs in a library, and the import has a preview step precisely
 * so a misread file is seen before it is stored.
 */
export function parseCsv(text: string): string[][] {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;

    if (quoted) {
      if (ch !== '"') {
        cell += ch;
      } else if (input[i + 1] === '"') {
        cell += '"';
        i++;
      } else {
        quoted = false;
      }
      continue;
    }

    if (ch === '"' && cell === "") {
      quoted = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\r") {
      // CRLF: the \n does the work, a lone \r still ends the line.
      if (input[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }

  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  // A trailing newline leaves one empty row; so does a blank line mid-file.
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/**
 * Rows as `{ header: value }`, keyed on the header line.
 *
 * The tab that `escapeCsvCell` prepends to formula-looking cells is stripped
 * back off here, so a file exported and re-imported round-trips unchanged.
 */
export function parseCsvRecords(text: string): { headers: string[]; records: Record<string, string>[] } {
  const rows = parseCsv(text);
  if (rows.length === 0) return { headers: [], records: [] };

  const headers = rows[0]!.map((h) => h.replace(/^\t/, "").trim());
  const records = rows.slice(1).map((cells) => {
    const record: Record<string, string> = {};
    headers.forEach((header, i) => {
      record[header] = (cells[i] ?? "").replace(/^\t/, "").trim();
    });
    return record;
  });

  return { headers, records };
}
