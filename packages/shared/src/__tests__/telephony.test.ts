import { describe, expect, it } from "vitest";
import {
  buildDialUrl,
  DEFAULT_TELEPHONY_SETTINGS,
  normalizeDialNumber,
  telephonySettingsUpdateSchema,
  type TelephonySettings,
} from "../schemas/telephony.js";

const settings = (over: Partial<TelephonySettings> = {}): TelephonySettings => ({
  ...DEFAULT_TELEPHONY_SETTINGS,
  ...over,
});

describe("normalizeDialNumber", () => {
  it("keeps a plain mobile untouched in AS_IS", () => {
    expect(normalizeDialNumber("0912 123-4567", settings())).toBe("09121234567");
  });

  it("reads Persian and Arabic-Indic digits", () => {
    expect(normalizeDialNumber("۰۹۱۲۱۲۳۴۵۶۷", settings())).toBe("09121234567");
    expect(normalizeDialNumber("٠٩١٢١٢٣٤٥٦٧", settings())).toBe("09121234567");
  });

  it("converts between national and E.164 in both directions", () => {
    expect(normalizeDialNumber("09121234567", settings({ numberFormat: "E164" }))).toBe("+989121234567");
    expect(normalizeDialNumber("+989121234567", settings({ numberFormat: "NATIONAL" }))).toBe("09121234567");
    expect(normalizeDialNumber("989121234567", settings({ numberFormat: "NATIONAL" }))).toBe("09121234567");
  });

  it("does not mistake a landline's area code for the country code", () => {
    // 021… is ten digits and starts with a 0, so the country-code strip must not
    // fire — otherwise Tehran numbers lose their first digits.
    expect(normalizeDialNumber("02122334455", settings({ numberFormat: "NATIONAL" }))).toBe("02122334455");
  });

  it("puts the outside-line prefix in front of the finished number", () => {
    expect(normalizeDialNumber("09121234567", settings({ dialPrefix: "9" }))).toBe("909121234567");
  });

  it("returns null when there is nothing to dial", () => {
    expect(normalizeDialNumber(null, settings())).toBeNull();
    expect(normalizeDialNumber("بدون شماره", settings())).toBeNull();
  });
});

describe("buildDialUrl", () => {
  it("defaults to a tel: link", () => {
    expect(buildDialUrl("09121234567")).toBe("tel:09121234567");
  });

  it("builds a SIP uri against the PBX host", () => {
    expect(buildDialUrl("09121234567", settings({ dialMode: "SIP", pbxHost: "pbx.clinic.ir" })))
      .toBe("sip:09121234567@pbx.clinic.ir");
  });

  it("opens the 3CX web client", () => {
    expect(buildDialUrl("09121234567", settings({ dialMode: "THREECX", pbxHost: "3cx.clinic.ir:5001" })))
      .toBe("https://3cx.clinic.ir:5001/webclient/#/call?phone=09121234567");
  });

  it("falls back to tel: when a mode is missing its host", () => {
    expect(buildDialUrl("09121234567", settings({ dialMode: "SIP" }))).toBe("tel:09121234567");
  });

  it("substitutes every placeholder in a custom template", () => {
    expect(buildDialUrl("09121234567", settings({
      dialMode: "CUSTOM",
      linkTemplate: "myphone://call/{number}?cid={number}",
    }))).toBe("myphone://call/09121234567?cid=09121234567");
  });
});

describe("telephonySettingsUpdateSchema", () => {
  it("rejects a PBX host that carries a scheme or a path", () => {
    expect(telephonySettingsUpdateSchema.safeParse({ pbxHost: "https://pbx.clinic.ir/x" }).success).toBe(false);
  });

  it("rejects SIP and 3CX without a host", () => {
    expect(telephonySettingsUpdateSchema.safeParse({ dialMode: "SIP", pbxHost: null }).success).toBe(false);
    expect(telephonySettingsUpdateSchema.safeParse({ dialMode: "THREECX" }).success).toBe(false);
  });

  it("rejects a custom template with no placeholder", () => {
    expect(telephonySettingsUpdateSchema.safeParse({ dialMode: "CUSTOM", linkTemplate: "myphone://call" }).success).toBe(false);
    expect(telephonySettingsUpdateSchema.safeParse({ dialMode: "CUSTOM", linkTemplate: "myphone://call/{number}" }).success).toBe(true);
  });

  it("accepts a full valid payload", () => {
    expect(telephonySettingsUpdateSchema.safeParse({
      dialMode: "THREECX",
      pbxHost: "3cx.clinic.ir:5001",
      linkTemplate: null,
      dialPrefix: "9",
      numberFormat: "E164",
      countryCode: "98",
    }).success).toBe(true);
  });
});
