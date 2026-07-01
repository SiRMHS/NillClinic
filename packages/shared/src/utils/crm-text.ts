/** Normalize Persian/Arabic variants and strip CRM noise (commas, extra spaces). */
const ARABIC_TO_PERSIAN: Record<string, string> = {
  ك: "ک",
  ي: "ی",
  ة: "ه",
  ى: "ی",
  "٠": "0",
  "١": "1",
  "٢": "2",
  "٣": "3",
  "٤": "4",
  "٥": "5",
  "٦": "6",
  "٧": "7",
  "٨": "8",
  "٩": "9",
};

export function normalizeCrmText(value: string | null | undefined): string {
  if (value == null) return "";

  let text = String(value);
  for (const [from, to] of Object.entries(ARABIC_TO_PERSIAN)) {
    text = text.replaceAll(from, to);
  }

  return text
    .replace(/[\u200c\u200f\u202a-\u202e]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s,،]+|[\s,،]+$/g, "")
    .trim();
}

/** Split comma-separated CRM labels into unique normalized parts. */
export function splitCrmLabels(value: string | null | undefined): string[] {
  if (!value) return [];

  const seen = new Set<string>();
  const result: string[] = [];

  for (const part of String(value).split(/[,،]/)) {
    const normalized = normalizeCrmText(part);
    if (!normalized) continue;
    const key = normalized.toLocaleLowerCase("fa");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }

  return result;
}

/** Join normalized labels for display/storage as a single canonical string. */
export function joinCrmLabels(labels: string[]): string {
  return labels.filter(Boolean).join("، ");
}

export function primaryCrmLabel(value: string | null | undefined, fallback = "نامشخص"): string {
  const labels = splitCrmLabels(value);
  return labels[0] ?? (normalizeCrmText(value) || fallback);
}
