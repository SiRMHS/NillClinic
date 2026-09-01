import ExcelJS from "exceljs";
import type { Response } from "express";

/**
 * Formatted Excel workbooks for the reports the clinic hands around.
 *
 * The CSV exports remain what they are — a data dump for someone who is going
 * to pivot it themselves. This is the other thing a report has to be: a
 * document that can go into a meeting without being reformatted first, with a
 * title, the range it covers, aligned columns and a totals line.
 *
 * The visual language is fixed here rather than chosen per report so every
 * workbook the dashboard produces looks like it came from the same place. The
 * palette is the dashboard's own (Tailwind gray-900 / gray-200 / gray-500).
 */

const INK = "FF111827"; // gray-900 — title bar, header text
const HEADER_BG = "FFE5E7EB"; // gray-200 — header row
const MUTED = "FF6B7280"; // gray-500 — the subtitle line
const TOTALS_BG = "FFF3F4F6"; // gray-100 — the totals line
const RULE = "FFD1D5DB"; // gray-300 — borders

/** Excel number formats. Percentages take a fraction (0.45), not 45. */
export const FMT = {
  /** ۱٬۲۳۴ */
  count: "#,##0",
  /** Rial. No decimals: these run to eleven digits and the rial has no minor unit in practice. */
  rial: "#,##0",
  /** ۴۵٪ */
  percent: "0%",
  /** ۴۵٫۳٪ — for rates where a whole percent is too coarse. */
  percent1: "0.0%",
  text: "@",
} as const;

export interface SheetColumn<T> {
  header: string;
  /** Column width in Excel units. Roughly one unit per character. */
  width: number;
  value: (row: T, index: number) => string | number | null;
  format?: string;
  align?: "right" | "left" | "center";
  /**
   * Carries money, so the column disappears when figures are hidden — the same
   * rule the CSV exports follow. A blank column under a live header invites
   * someone to go looking for the data that should have been there.
   */
  money?: boolean;
  /** How this column is summed on the totals line, if at all. */
  total?: "sum" | "none";
}

export interface Sheet<T> {
  name: string;
  title: string;
  /** The line under the title — usually the Jalali range the report covers. */
  subtitle?: string;
  columns: SheetColumn<T>[];
  rows: T[];
  /** Adds a bold totals line under the data. */
  totals?: boolean;
  /** Shown instead of a table when there is nothing to report. */
  emptyNote?: string;
}

/**
 * A sheet of label/value pairs, for the summary page.
 *
 * Deliberately not a one-row table: a reader opening a report wants the
 * headline numbers stacked and readable, not a horizontal strip they have to
 * scroll to take in.
 */
export interface SummarySheet {
  name: string;
  title: string;
  subtitle?: string;
  rows: { label: string; value: string | number; format?: string; money?: boolean }[];
}

function isRtl(): boolean {
  // Every report this app produces is Persian.
  return true;
}

/** Title bar + subtitle + a blank spacer. Returns the row the table starts on. */
function writeHeading(
  ws: ExcelJS.Worksheet,
  title: string,
  subtitle: string | undefined,
  width: number,
): number {
  ws.mergeCells(1, 1, 1, width);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = title;
  titleCell.font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INK } };
  titleCell.alignment = { horizontal: "right", vertical: "middle" };
  ws.getRow(1).height = 21;

  if (subtitle) {
    ws.mergeCells(2, 1, 2, width);
    const sub = ws.getCell(2, 1);
    sub.value = subtitle;
    sub.font = { size: 11, color: { argb: MUTED } };
    sub.alignment = { horizontal: "right", vertical: "middle" };
  }

  return subtitle ? 4 : 3;
}

export function addSheet<T>(wb: ExcelJS.Workbook, sheet: Sheet<T>, hideMoney: boolean): void {
  const columns = hideMoney ? sheet.columns.filter((c) => !c.money) : sheet.columns;
  const ws = wb.addWorksheet(sheet.name, {
    views: [{ rightToLeft: isRtl() }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  const headerRowIndex = writeHeading(ws, sheet.title, sheet.subtitle, columns.length);

  if (sheet.rows.length === 0) {
    const note = ws.getCell(headerRowIndex, 1);
    note.value = sheet.emptyNote ?? "داده‌ای برای این بازه ثبت نشده است.";
    note.font = { size: 11, color: { argb: MUTED } };
    note.alignment = { horizontal: "right" };
    ws.mergeCells(headerRowIndex, 1, headerRowIndex, columns.length);
    return;
  }

  const header = ws.getRow(headerRowIndex);
  columns.forEach((col, i) => {
    const cell = header.getCell(i + 1);
    cell.value = col.header;
    cell.font = { bold: true, size: 11, color: { argb: INK } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = { bottom: { style: "thin", color: { argb: RULE } } };
    ws.getColumn(i + 1).width = col.width;
  });
  header.height = 29.25;

  sheet.rows.forEach((row, index) => {
    const excelRow = ws.getRow(headerRowIndex + 1 + index);
    columns.forEach((col, i) => {
      const cell = excelRow.getCell(i + 1);
      cell.value = col.value(row, index);
      cell.font = { size: 11 };
      cell.numFmt = col.format ?? FMT.text;
      cell.alignment = { horizontal: col.align ?? "center", vertical: "middle" };
    });
    excelRow.height = 29.25;
  });

  if (sheet.totals) {
    const totalsRow = ws.getRow(headerRowIndex + 1 + sheet.rows.length);
    columns.forEach((col, i) => {
      const cell = totalsRow.getCell(i + 1);
      if (i === 0) {
        cell.value = "جمع";
      } else if (col.total === "sum") {
        // Summed here rather than left to an Excel formula: the report is read
        // as a document, and a formula would show as 0 in any viewer that does
        // not calculate on open.
        cell.value = sheet.rows.reduce((sum, row, index) => {
          const v = col.value(row, index);
          return sum + (typeof v === "number" ? v : 0);
        }, 0);
        cell.numFmt = col.format ?? FMT.count;
      }
      cell.font = { bold: true, size: 11, color: { argb: INK } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTALS_BG } };
      cell.alignment = { horizontal: i === 0 ? "center" : (col.align ?? "center"), vertical: "middle" };
      cell.border = { top: { style: "thin", color: { argb: RULE } } };
    });
    totalsRow.height = 29.25;
  }

  // Freeze the heading and the header row, so scrolling a long table keeps the
  // column names — the single thing that makes a 200-row sheet readable.
  ws.views = [{ state: "frozen", ySplit: headerRowIndex, rightToLeft: isRtl() }];
  ws.autoFilter = {
    from: { row: headerRowIndex, column: 1 },
    to: { row: headerRowIndex + sheet.rows.length, column: columns.length },
  };
}

export function addSummarySheet(
  wb: ExcelJS.Workbook,
  sheet: SummarySheet,
  hideMoney: boolean,
): void {
  const rows = hideMoney ? sheet.rows.filter((r) => !r.money) : sheet.rows;
  const ws = wb.addWorksheet(sheet.name, { views: [{ rightToLeft: isRtl() }] });

  const startRow = writeHeading(ws, sheet.title, sheet.subtitle, 2);
  ws.getColumn(1).width = 34;
  ws.getColumn(2).width = 24;

  rows.forEach((row, i) => {
    const excelRow = ws.getRow(startRow + i);
    const label = excelRow.getCell(1);
    label.value = row.label;
    label.font = { size: 11, color: { argb: INK } };
    label.alignment = { horizontal: "right", vertical: "middle" };

    const value = excelRow.getCell(2);
    value.value = row.value;
    value.font = { bold: true, size: 12, color: { argb: INK } };
    value.numFmt = row.format ?? FMT.text;
    value.alignment = { horizontal: "center", vertical: "middle" };

    excelRow.height = 26;
    for (const cell of [label, value]) {
      cell.border = { bottom: { style: "hair", color: { argb: RULE } } };
    }
  });
}

export function createWorkbook(title: string): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "داشبورد کلینیک جردن";
  wb.title = title;
  // `created` is left at the library default (now); the report's own generated
  // time is printed on the summary sheet where a reader will actually see it.
  return wb;
}

/**
 * Send a workbook as a download.
 *
 * Mirrors `sendCsv`: the filename goes out twice, plain ASCII for old clients
 * and RFC 5987 for the real Persian name, because sending only the Persian form
 * makes the header invalid and browsers fall back to the URL path.
 */
export async function sendXlsx(
  res: Response,
  filename: string,
  wb: ExcelJS.Workbook,
): Promise<void> {
  const ascii = filename.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
  );
  const buffer = await wb.xlsx.writeBuffer();
  res.end(Buffer.from(buffer));
}

/** `گزارش-پزشکان-1405-05-22.xlsx` — Jalali-stamped so exports self-describe. */
export function stampedXlsxName(prefix: string, jalaliDate: string): string {
  return `${prefix}-${jalaliDate.replace(/\//g, "-")}.xlsx`;
}
