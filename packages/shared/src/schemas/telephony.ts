import { z } from "zod";
import { toLatinDigits } from "../utils/jalali.js";

/**
 * Click-to-call: how a lead's mobile number becomes something the phone system
 * can dial.
 *
 * The clinic runs Issabel on the desks and has to keep working if a 3CX line is
 * put next to it, so neither one is baked in. `buildDialUrl` lives here rather
 * than in the web app because the API validates the same settings it produces
 * links from, and a second copy of the rules would drift.
 */

export const dialModeSchema = z.enum(["TEL", "CALLTO", "SIP", "THREECX", "CUSTOM"]);
export const dialNumberFormatSchema = z.enum(["AS_IS", "NATIONAL", "E164"]);

export type DialMode = z.infer<typeof dialModeSchema>;
export type DialNumberFormat = z.infer<typeof dialNumberFormatSchema>;

export const DIAL_MODE_LABELS: Record<DialMode, string> = {
  TEL: "لینک tel: (پیش‌فرض سیستم‌عامل)",
  CALLTO: "لینک callto:",
  SIP: "لینک sip: (سافت‌فون Issabel / Asterisk)",
  THREECX: "وب‌کلاینت 3CX",
  CUSTOM: "الگوی دلخواه",
};

export const DIAL_NUMBER_FORMAT_LABELS: Record<DialNumberFormat, string> = {
  AS_IS: "همان‌طور که ثبت شده",
  NATIONAL: "شماره داخلی کشور (۰۹۱۲…)",
  E164: "بین‌المللی (+۹۸۹۱۲…)",
};

export const telephonySettingsSchema = z.object({
  dialMode: dialModeSchema,
  pbxHost: z.string().nullable(),
  linkTemplate: z.string().nullable(),
  dialPrefix: z.string(),
  numberFormat: dialNumberFormatSchema,
  countryCode: z.string(),
});

export type TelephonySettings = z.infer<typeof telephonySettingsSchema>;

export const DEFAULT_TELEPHONY_SETTINGS: TelephonySettings = {
  dialMode: "TEL",
  pbxHost: null,
  linkTemplate: null,
  dialPrefix: "",
  numberFormat: "AS_IS",
  countryCode: "98",
};

/** A hostname, optionally with a port — no scheme, no path. */
const hostPattern = /^[a-zA-Z0-9.-]+(:\d{1,5})?$/;

export const telephonySettingsUpdateSchema = telephonySettingsSchema
  .partial()
  .extend({
    pbxHost: z.string().trim().max(200).nullable().optional(),
    linkTemplate: z.string().trim().max(500).nullable().optional(),
    dialPrefix: z.string().trim().max(10).optional(),
    countryCode: z.string().trim().max(5).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.pbxHost && !hostPattern.test(v.pbxHost)) {
      ctx.addIssue({
        code: "custom",
        path: ["pbxHost"],
        message: "آدرس PBX باید فقط نام دامنه یا IP باشد (بدون https:// و بدون مسیر)",
      });
    }
    // A host-less SIP or 3CX link would dial into nothing, and a CUSTOM
    // template with no placeholder would dial the same number every time — both
    // fail silently in the browser, so they are rejected here instead.
    if ((v.dialMode === "SIP" || v.dialMode === "THREECX") && !v.pbxHost) {
      ctx.addIssue({ code: "custom", path: ["pbxHost"], message: "برای این حالت آدرس PBX لازم است" });
    }
    if (v.dialMode === "CUSTOM" && !v.linkTemplate?.includes("{number}")) {
      ctx.addIssue({ code: "custom", path: ["linkTemplate"], message: "الگو باید شامل {number} باشد" });
    }
    if (v.dialPrefix && !/^\d+$/.test(v.dialPrefix)) {
      ctx.addIssue({ code: "custom", path: ["dialPrefix"], message: "پیش‌شماره فقط رقم" });
    }
    if (v.countryCode && !/^\d+$/.test(v.countryCode)) {
      ctx.addIssue({ code: "custom", path: ["countryCode"], message: "کد کشور فقط رقم" });
    }
  });

export type TelephonySettingsUpdate = z.infer<typeof telephonySettingsUpdateSchema>;

/**
 * Strip everything a human might have typed around the number, then reshape it
 * for the trunk. Returns null when nothing dialable is left.
 */
export function normalizeDialNumber(
  raw: string | null | undefined,
  settings: Pick<TelephonySettings, "numberFormat" | "countryCode" | "dialPrefix">,
): string | null {
  if (!raw) return null;
  const latin = toLatinDigits(raw).trim();
  const hadPlus = latin.startsWith("+");
  let digits = latin.replace(/\D/g, "");
  if (!digits) return null;

  const cc = settings.countryCode.replace(/\D/g, "");
  // Reduce to the national significant number first, so the three formats below
  // all start from the same thing no matter how the lead was stored.
  let national = digits;
  if (cc && (hadPlus || digits.length > 10) && national.startsWith(cc)) {
    national = national.slice(cc.length);
  }
  national = national.replace(/^0+/, "");

  switch (settings.numberFormat) {
    case "NATIONAL":
      digits = `0${national}`;
      break;
    case "E164":
      digits = cc ? `+${cc}${national}` : `+${national}`;
      break;
    case "AS_IS":
      break;
  }

  return settings.dialPrefix ? `${settings.dialPrefix}${digits}` : digits;
}

/**
 * The href behind the dial button, or null when there is nothing to dial.
 *
 * The 3CX link opens the web client rather than a URI scheme: the browser
 * client never registers as a `tel:` handler, so a plain tel link on a desk
 * that only has 3CX opens nothing at all.
 */
export function buildDialUrl(
  mobile: string | null | undefined,
  settings: TelephonySettings = DEFAULT_TELEPHONY_SETTINGS,
): string | null {
  const number = normalizeDialNumber(mobile, settings);
  if (!number) return null;

  switch (settings.dialMode) {
    case "CALLTO":
      return `callto:${number}`;
    case "SIP":
      return settings.pbxHost ? `sip:${number}@${settings.pbxHost}` : `tel:${number}`;
    case "THREECX":
      return settings.pbxHost
        ? `https://${settings.pbxHost}/webclient/#/call?phone=${encodeURIComponent(number)}`
        : `tel:${number}`;
    case "CUSTOM":
      return settings.linkTemplate
        ? settings.linkTemplate.replaceAll("{number}", encodeURIComponent(number))
        : `tel:${number}`;
    case "TEL":
      return `tel:${number}`;
  }
}
