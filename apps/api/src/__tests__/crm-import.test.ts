import { describe, expect, it } from "vitest";
import { parseCsv, parseCsvRecords, toCsv } from "../lib/csv.js";
import { parseContactCsv, parseScheduleCsv } from "../lib/crm-import.js";
import { maskFields, AMOUNT_FIELDS } from "../lib/display-settings.js";

describe("parseCsv", () => {
  it("reads quoted fields, doubled quotes and embedded newlines", () => {
    expect(parseCsv('a,"b,1","he said ""hi"""\r\nc,"two\nlines",d\r\n')).toEqual([
      ["a", "b,1", 'he said "hi"'],
      ["c", "two\nlines", "d"],
    ]);
  });

  it("survives the BOM and the tab guard that toCsv writes", () => {
    const csv = toCsv([{ name: "=SUM(A1)" }], [{ header: "نام", value: (r) => r.name }]);
    expect(parseCsvRecords(csv).records[0]).toEqual({ "نام": "=SUM(A1)" });
  });
});

describe("parseContactCsv", () => {
  const header =
    "نوع,شماره پرونده بیمار,نام بیمار,تاریخ تماس,مبلغ دریافت شده,پزشک,نحوه آشنایی,پاسخگویی\r\n";

  it("maps Persian labels back to enum values", () => {
    const preview = parseContactCsv(
      header + "نظرسنجی,۱۲۳۴,علی رضایی,۱۴۰۵/۰۵/۲۲,12500000,عالی,\"سایت، اینستاگرام\",پاسخ داد\r\n",
    );

    expect(preview.summary).toMatchObject({ total: 1, valid: 1, invalid: 0 });
    expect(preview.rows[0]!.data).toMatchObject({
      kind: "SURVEY",
      patientExternalCode: 1234,
      patientName: "علی رضایی",
      contactDate: "1405/05/22",
      amount: 12500000,
      doctorRating: "EXCELLENT",
      channels: ["SITE", "INSTAGRAM"],
      callResult: "ANSWERED",
    });
  });

  it("rejects a row with no contact date and keeps the rest of the file", () => {
    const preview = parseContactCsv(header + "تماس فالوآپ,,بدون تاریخ,,,,,\r\n");
    expect(preview.summary).toMatchObject({ valid: 0, invalid: 1 });
    expect(preview.rows[0]!.errors[0]!.column).toBe("تاریخ تماس");
  });

  it("keeps prose amounts as text and warns instead of inventing a number", () => {
    const preview = parseContactCsv(
      header + "تماس فالوآپ,,علی,۱۴۰۵/۰۵/۲۲,ده میلیون تومان,,,\r\n",
    );
    expect(preview.rows[0]!.data).toMatchObject({ amountText: "ده میلیون تومان" });
    expect(preview.rows[0]!.data?.amount ?? null).toBeNull();
    expect(preview.rows[0]!.warnings[0]!.column).toBe("مبلغ دریافت شده");
  });

  it("warns on an unknown rating rather than dropping the call", () => {
    const preview = parseContactCsv(header + "تماس فالوآپ,,علی,۱۴۰۵/۰۵/۲۲,,فوق‌العاده,,\r\n");
    expect(preview.rows[0]!.data).toBeTruthy();
    expect(preview.rows[0]!.warnings[0]!.column).toBe("پزشک");
  });

  it("refuses a file that is missing the date column outright", () => {
    expect(() => parseContactCsv("نام بیمار\r\nعلی\r\n")).toThrow(/تاریخ تماس/);
  });

  it("splits the multi-valued service columns the export writes", () => {
    const preview = parseContactCsv(
      "تاریخ تماس,خدمات انجام شده,خدمات گرفته‌شده\r\n" +
        '۱۴۰۵/۰۵/۲۲,"بوتاکس پیشانی، تزریق ژل","مزوتراپی مو"\r\n',
    );
    expect(preview.rows[0]!.data).toMatchObject({
      serviceNames: ["بوتاکس پیشانی", "تزریق ژل"],
      treatmentServiceNames: ["مزوتراپی مو"],
    });
  });

  it("reads the referral columns the way the export writes them", () => {
    // «ارجاع به پزشک» carries the name and «توضیح ارجاع» the reason, so an
    // exported file round-trips into the same two fields it came out of.
    const preview = parseContactCsv(
      "تاریخ تماس,ارجاع به پزشک,توضیح ارجاع,درمان توسط,تاریخ درمان\r\n" +
        "۱۴۰۵/۰۵/۲۲,دکتر احمدی,عدم پاسخ به درمان قبلی,دکتر رضایی,۱۴۰۵/۰۶/۰۱\r\n",
    );
    expect(preview.rows[0]!.data).toMatchObject({
      referredDoctorName: "دکتر احمدی",
      doctorReferral: "عدم پاسخ به درمان قبلی",
      treatmentDoctorName: "دکتر رضایی",
      treatmentDate: "1405/06/01",
    });
  });
});

describe("parseScheduleCsv", () => {
  it("reads the weekday grid into one entry per filled cell", () => {
    const preview = parseScheduleCsv(
      "نام پزشک,شنبه,یکشنبه,دوشنبه,سه‌شنبه,چهارشنبه,پنج‌شنبه,جمعه\r\n" +
        "دکتر احمدی,صبح,,عصر,,,,\r\n",
    );
    expect(preview.rows[0]!.data).toEqual([
      { doctorName: "دکتر احمدی", weekday: 0, note: "صبح" },
      { doctorName: "دکتر احمدی", weekday: 2, note: "عصر" },
    ]);
  });
});

describe("maskFields", () => {
  it("nulls money wherever it is nested, leaving the shape intact", () => {
    const masked = maskFields(
      { data: [{ id: "a", amount: 5, satisfaction: 90 }], pagination: { total: 1 } },
      AMOUNT_FIELDS,
    );
    expect(masked).toEqual({
      data: [{ id: "a", amount: null, satisfaction: 90 }],
      pagination: { total: 1 },
    });
  });
});
