import {
  CRM_CALL_RESULT_LABELS,
  CRM_CHANNEL_LABELS,
  CRM_CONTACT_KIND_LABELS,
  CRM_LIKELIHOOD_LABELS,
  CRM_RATING_LABELS,
  CRM_WEEKDAYS,
  crmContactInputSchema,
  splitCrmLabels,
  toLatinDigits,
  type CrmContactInput,
} from "@jordan/shared";
import { parseCsvRecords } from "./csv.js";

/**
 * Reading a CRM export back in.
 *
 * The file the desk uploads is the file this API hands out — same Persian
 * headers, same label text in the cells — because the realistic workflow is
 * "export, fix a column in Excel, upload again", and a separate import format
 * would mean the desk maintaining two vocabularies. Columns the export derives
 * (رضایت کلی، ریسک ریزش، امتیاز وفاداری) are ignored on the way back in: they
 * are computed from the ratings, and honouring a hand-edited copy would let the
 * file disagree with the scores everything else in the app reads.
 *
 * Nothing here writes. Parsing returns per-row verdicts that the preview step
 * shows the operator, and only the rows they then confirm are stored.
 */

/** «عالی» → `EXCELLENT`, for every label map the export prints. */
function reverse<T extends string>(labels: Record<T, string>): Map<string, T> {
  const map = new Map<string, T>();
  for (const [key, label] of Object.entries(labels) as [T, string][]) {
    map.set(label.trim(), key);
    // The enum name itself is accepted too: a file produced by another tool, or
    // by someone reading the API, should not be rejected over cosmetics.
    map.set(key, key);
  }
  return map;
}

const KINDS = reverse(CRM_CONTACT_KIND_LABELS);
const RATINGS = reverse(CRM_RATING_LABELS);
const LIKELIHOODS = reverse(CRM_LIKELIHOOD_LABELS);
const CALL_RESULTS = reverse(CRM_CALL_RESULT_LABELS);
const CHANNELS = reverse(CRM_CHANNEL_LABELS);

/** Jalali dates arrive with Persian digits and either separator. */
function normalizeDate(raw: string): string {
  return toLatinDigits(raw).replace(/[.\-]/g, "/").trim();
}

/**
 * `«۱۲٬۵۰۰٬۰۰۰»` → `12500000`.
 *
 * The amount column is free text in the source spreadsheet — the desk wrote
 * «۱۰ میلیون و ۹۰۰ هزار تومان» in it for years — so the prose is kept verbatim
 * in `amountText` and only a cell that is unambiguously a number becomes the
 * numeric `amount` the reports sum. Guessing at the prose would invent figures.
 */
function parseAmount(raw: string): number | null {
  const latin = toLatinDigits(raw).replace(/[,٬\s]/g, "");
  if (!/^\d+(\.\d+)?$/.test(latin)) return null;
  const n = Number(latin);
  return Number.isFinite(n) ? n : null;
}

export interface ImportIssue {
  column: string;
  message: string;
}

export interface ImportRow<T> {
  /** 1-based line in the uploaded file, header included — what Excel shows. */
  line: number;
  data: T | null;
  errors: ImportIssue[];
  /** Non-fatal: the row imports, but something in it was not understood. */
  warnings: ImportIssue[];
}

export interface ImportPreview<T> {
  rows: ImportRow<T>[];
  summary: { total: number; valid: number; invalid: number; warnings: number };
  /** Headers in the file that this importer does not use. */
  unknownColumns: string[];
}

function summarize<T>(rows: ImportRow<T>[], unknownColumns: string[]): ImportPreview<T> {
  return {
    rows,
    summary: {
      total: rows.length,
      valid: rows.filter((r) => r.data !== null).length,
      invalid: rows.filter((r) => r.data === null).length,
      warnings: rows.filter((r) => r.warnings.length > 0).length,
    },
    unknownColumns,
  };
}

// ─── Contacts ───

/** Header → the input field it fills. Mirrors the export, column for column. */
const CONTACT_TEXT_COLUMNS: Record<string, keyof CrmContactInput> = {
  "نام بیمار": "patientName",
  موبایل: "patientMobile",
  "نام پزشک": "doctorName",
  "خدمات انجام شده": "serviceName",
  پیشنهاد: "suggestion",
  توضیحات: "notes",
  "وقت مجدد": "rebookNote",
  "بروز نتایج": "resultsOnset",
  عوارض: "sideEffect",
  "نظر کلی": "overallOpinion",
  "درد/ورم": "painSwelling",
  تاخیر: "delayComplaint",
  "نکته مثبت": "positiveNote",
  // The export writes the referred doctor's name under «ارجاع به پزشک» and the
  // reason under «توضیح ارجاع», so an exported file re-imports into the same
  // two columns it came out of.
  "ارجاع به پزشک": "referredDoctorName",
  "توضیح ارجاع": "doctorReferral",
  "درمان توسط": "treatmentDoctorName",
  "خلاصه حرف بیمار": "patientSummary",
  "ارجاع به کال‌سنتر": "callCenterReferral",
  "نتیجه رضایت‌سنجی مجدد": "resurveyResult",
};

const CONTACT_RATING_COLUMNS: Record<string, keyof CrmContactInput> = {
  "وقت‌دهی": "schedulingRating",
  پزشک: "doctorRating",
  دستیار: "assistantRating",
  پذیرش: "receptionRating",
  بهداشت: "hygieneRating",
};

const CONTACT_LIKELIHOOD_COLUMNS: Record<string, keyof CrmContactInput> = {
  "احتمال معرفی به دیگران": "referralLikelihood",
  "احتمال مراجعه مجدد": "revisitLikelihood",
};

/** Derived on read; a value in the file is ignored rather than trusted. */
const DERIVED_COLUMNS = [
  "رضایت کلی (٪)",
  "شاخص NPS",
  "ریسک ریزش (٪)",
  "سطح ریسک",
  "امتیاز وفاداری",
  "ثبت‌کننده",
];

export const CONTACT_IMPORT_HEADERS = [
  "نوع",
  "شماره پرونده بیمار",
  "نام بیمار",
  "موبایل",
  "نام پزشک",
  "تاریخ مراجعه",
  "تاریخ تماس",
  "خدمات انجام شده",
  "مبلغ دریافت شده",
  ...Object.keys(CONTACT_RATING_COLUMNS),
  ...Object.keys(CONTACT_LIKELIHOOD_COLUMNS),
  "نحوه آشنایی",
  "پاسخگویی",
  "پیشنهاد",
  "توضیحات",
  "وقت مجدد",
  "بروز نتایج",
  "عوارض",
  "نظر کلی",
  "درد/ورم",
  "تاخیر",
  "نکته مثبت",
  "ارجاع به پزشک",
  "توضیح ارجاع",
  "درمان توسط",
  "خدمات گرفته‌شده",
  "تاریخ درمان",
  "خلاصه حرف بیمار",
  "ارجاع به کال‌سنتر",
  "تاریخ رضایت‌سنجی مجدد",
  "نتیجه رضایت‌سنجی مجدد",
];

const KNOWN_CONTACT_COLUMNS = new Set([...CONTACT_IMPORT_HEADERS, ...DERIVED_COLUMNS]);

export function parseContactCsv(text: string): ImportPreview<CrmContactInput> {
  const { headers, records } = parseCsvRecords(text);

  if (!headers.includes("تاریخ تماس")) {
    throw new Error("ستون «تاریخ تماس» در فایل پیدا نشد — از قالب نمونه استفاده کنید");
  }

  const unknownColumns = headers.filter((h) => h && !KNOWN_CONTACT_COLUMNS.has(h));

  const rows = records.map((record, index): ImportRow<CrmContactInput> => {
    const errors: ImportIssue[] = [];
    const warnings: ImportIssue[] = [];
    const cell = (header: string) => (record[header] ?? "").trim();

    const input: Record<string, unknown> = {};

    // Enum columns: an unrecognised label is a warning, not a rejection. The
    // rest of the row is still worth keeping, and blanking one rating loses
    // less than dropping a whole follow-up call.
    const readEnum = (header: string, map: Map<string, string>, field: string) => {
      const raw = cell(header);
      if (!raw) return;
      const value = map.get(raw);
      if (value) input[field] = value;
      else warnings.push({ column: header, message: `مقدار «${raw}» شناخته نشد و خالی ثبت می‌شود` });
    };

    readEnum("نوع", KINDS, "kind");
    if (!input.kind) input.kind = "FOLLOW_UP";

    for (const [header, field] of Object.entries(CONTACT_RATING_COLUMNS)) {
      readEnum(header, RATINGS, field);
    }
    for (const [header, field] of Object.entries(CONTACT_LIKELIHOOD_COLUMNS)) {
      readEnum(header, LIKELIHOODS, field);
    }
    readEnum("پاسخگویی", CALL_RESULTS, "callResult");

    for (const [header, field] of Object.entries(CONTACT_TEXT_COLUMNS)) {
      const raw = cell(header);
      if (raw) input[field] = raw;
    }

    // نحوه آشنایی is multi-valued, written «سایت، اینستاگرام» by the export.
    const channelsRaw = cell("نحوه آشنایی");
    if (channelsRaw) {
      const channels: string[] = [];
      for (const part of channelsRaw.split(/[،,]/)) {
        const name = part.trim();
        if (!name) continue;
        const value = CHANNELS.get(name);
        if (value) channels.push(value);
        else warnings.push({ column: "نحوه آشنایی", message: `کانال «${name}» شناخته نشد` });
      }
      input.channels = channels;
    }

    const code = toLatinDigits(cell("شماره پرونده بیمار")).replace(/\D/g, "");
    if (code) input.patientExternalCode = Number(code);

    for (const [header, field] of [
      ["تاریخ مراجعه", "visitDate"],
      ["تاریخ تماس", "contactDate"],
      ["تاریخ رضایت‌سنجی مجدد", "resurveyDate"],
      ["تاریخ درمان", "treatmentDate"],
    ] as const) {
      const raw = cell(header);
      if (raw) input[field] = normalizeDate(raw);
    }

    // Service columns are multi-valued, joined the way the export writes them.
    // Names are not checked against the catalogue: a file may legitimately name
    // a service that has since been renamed or retired, and rejecting the row
    // over it would lose the whole follow-up call.
    for (const [header, field] of [
      ["خدمات انجام شده", "serviceNames"],
      ["خدمات گرفته‌شده", "treatmentServiceNames"],
    ] as const) {
      const names = splitCrmLabels(cell(header));
      if (names.length > 0) input[field] = names;
    }

    if (!input.contactDate) {
      errors.push({ column: "تاریخ تماس", message: "تاریخ تماس الزامی است" });
    }

    const amountRaw = cell("مبلغ دریافت شده");
    if (amountRaw) {
      input.amountText = amountRaw;
      const amount = parseAmount(amountRaw);
      if (amount !== null) input.amount = amount;
      else {
        warnings.push({
          column: "مبلغ دریافت شده",
          message: "عدد قابل خواندن نبود؛ متن حفظ می‌شود ولی در جمع مبالغ نمی‌آید",
        });
      }
    }

    const line = index + 2; // header is line 1

    if (errors.length > 0) return { line, data: null, errors, warnings };

    const parsed = crmContactInputSchema.safeParse(input);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        errors.push({ column: String(issue.path[0] ?? ""), message: issue.message });
      }
      return { line, data: null, errors, warnings };
    }

    return { line, data: parsed.data, errors, warnings };
  });

  return summarize(rows, unknownColumns);
}

// ─── Doctor weekday schedule ───

export interface ScheduleEntryInput {
  doctorName: string;
  weekday: number;
  note: string | null;
}

export const SCHEDULE_IMPORT_HEADERS = ["نام پزشک", ...CRM_WEEKDAYS];

/**
 * The schedule is a grid — one row per doctor, one column per weekday — so it
 * imports as the grid rather than as one row per cell. That is how the sheet
 * looks in Excel, and it is what an operator will hand back after editing it.
 */
export function parseScheduleCsv(text: string): ImportPreview<ScheduleEntryInput[]> {
  const { headers, records } = parseCsvRecords(text);

  if (!headers.includes("نام پزشک")) {
    throw new Error("ستون «نام پزشک» در فایل پیدا نشد — از قالب نمونه استفاده کنید");
  }

  const unknownColumns = headers.filter((h) => h && !SCHEDULE_IMPORT_HEADERS.includes(h));

  const rows = records.map((record, index): ImportRow<ScheduleEntryInput[]> => {
    const errors: ImportIssue[] = [];
    const warnings: ImportIssue[] = [];
    const line = index + 2;

    const doctorName = (record["نام پزشک"] ?? "").trim();
    if (!doctorName) {
      errors.push({ column: "نام پزشک", message: "نام پزشک الزامی است" });
      return { line, data: null, errors, warnings };
    }
    if (doctorName.length > 200) {
      errors.push({ column: "نام پزشک", message: "نام پزشک طولانی‌تر از حد مجاز است" });
      return { line, data: null, errors, warnings };
    }

    const entries: ScheduleEntryInput[] = [];
    CRM_WEEKDAYS.forEach((day, weekday) => {
      const note = (record[day] ?? "").trim();
      if (!note) return;
      if (note.length > 200) {
        warnings.push({ column: day, message: "متن طولانی بود و کوتاه شد" });
      }
      entries.push({ doctorName, weekday, note: note.slice(0, 200) });
    });

    return { line, data: entries, errors, warnings };
  });

  return summarize(rows, unknownColumns);
}
