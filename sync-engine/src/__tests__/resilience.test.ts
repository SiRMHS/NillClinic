import { describe, it, expect } from "vitest";
import { MappingEngine, reserveExternalKey } from "../mapping.engine.js";
import {
  jalaliToSqlDate,
  jalaliWindows,
  addJalaliDays,
  jalaliToDate,
  dateToJalali,
  toLatinDigits,
  parseJalali,
  financialRangeSchema,
} from "@jordan/shared";

/**
 * Regression tests for the data-loss bugs found in the previous sync engine.
 * Each case below corresponds to a defect that silently destroyed real records.
 */

const engine = new MappingEngine();

describe("patients: CRM nulls must not reject records", () => {
  // Verbatim payloads from the failing production sync log.
  const nullGenderPatient = {
    fullName: "اشکان کلانتري",
    mobile: "09126873611",
    patientCode: 7206,
    tel: "",
    gender: null,
    address: "",
    degree: null,
    fatherName: "",
    birthDate: " ",
    residentCountry: null,
    introduction: null,
    job: "",
    isResident: null,
  };

  it("keeps a patient whose gender is null", () => {
    const { valid, invalid } = engine.mapPatients([nullGenderPatient]);
    expect(invalid).toHaveLength(0);
    expect(valid).toHaveLength(1);
    expect(valid[0]!.externalCode).toBe(7206);
    expect(valid[0]!.plaintext.gender).toBeNull();
  });

  it("collapses a whitespace-only birthDate to null rather than storing a blank", () => {
    const { valid } = engine.mapPatients([nullGenderPatient]);
    expect(valid[0]!.plaintext.birthDate).toBeNull();
  });

  it("still rejects a record with no usable identity", () => {
    const { valid, invalid } = engine.mapPatients([{ ...nullGenderPatient, patientCode: null }]);
    expect(valid).toHaveLength(0);
    expect(invalid).toHaveLength(1);
  });
});

describe("reserves: identity must not collapse distinct bookings", () => {
  const base = {
    reserveDate: "1405/06/19",
    reserveTime: "13:30",
    services: "ویزیت,",
    createDate: "1405/06/01",
    createTime: "10:00",
    isAccepted: false,
    doctorName: "نیلوفر نجار نوبری",
  };

  it("keeps three patients sharing one doctor and time slot", () => {
    // The old unique key was (reserveDate, reserveTime, doctorName): these three
    // real bookings collapsed into one row, destroying two of them.
    const raw = [
      { ...base, patientName: "شیما ابراهیمی", patientCode: 107770, patientMobile: "09120000001" },
      { ...base, patientName: "مسعود ابراهیمی", patientCode: 120239, patientMobile: "09120000002" },
      { ...base, patientName: "نازنین الزهرا مراغه", patientCode: 106528, patientMobile: "09120000003" },
    ];
    const { valid, invalid } = engine.mapReserves(raw);
    expect(invalid).toHaveLength(0);
    expect(valid).toHaveLength(3);
    expect(new Set(valid.map((v) => v.externalKey)).size).toBe(3);
  });

  it("keeps a reserve whose doctorName is null", () => {
    const { valid, invalid } = engine.mapReserves([
      { ...base, doctorName: null, patientName: null, patientCode: null, patientMobile: null },
    ]);
    expect(invalid).toHaveLength(0);
    expect(valid[0]!.data.doctorName).toBeNull();
  });

  it("derives a stable key for the same booking across syncs", () => {
    const input = {
      reserveDate: "1405/06/19",
      reserveTime: "13:30",
      doctorName: "دکتر الف",
      patientCode: 1,
      patientName: "بیمار",
      patientMobile: "0912",
    };
    expect(reserveExternalKey(input)).toBe(reserveExternalKey({ ...input }));
  });

  it("distinguishes null from empty string in the key", () => {
    const a = reserveExternalKey({
      reserveDate: "1405/06/19", reserveTime: "13:30", doctorName: "د",
      patientCode: null, patientName: null, patientMobile: null,
    });
    const b = reserveExternalKey({
      reserveDate: "1405/06/19", reserveTime: "13:30", doctorName: "د",
      patientCode: 5, patientName: null, patientMobile: null,
    });
    expect(a).not.toBe(b);
  });

  it("deduplicates a reserve repeated within one batch", () => {
    const row = { ...base, patientName: "الف", patientCode: 1, patientMobile: "0912" };
    const { valid } = engine.mapReserves([row, { ...row }]);
    expect(valid).toHaveLength(1);
  });
});

describe("receptions: financial fields must survive parsing", () => {
  const reception = {
    receptionDate: "1405/05/19",
    receptionId: 453726,
    receptionNo: 20018,
    patientNo: 110650,
    isReturn: false,
    receptionDescription: "کیوسک",
    treatmentItemNames: "خشکی پوست",
    userName: "صندوق کیوسک 1",
    receptionDetailDtos: [
      {
        secId: 10,
        srvId: 4,
        secName: "عمومی",
        srvName: "ویزیت",
        receptionPersonnelName: "معصومه محمدی",
        receivedPrice: 5000000.0,
        remainPrice: 1000.5,
        discount: 250000.0,
        depositPrice: 7.25,
      },
    ],
  };

  it("preserves every monetary field instead of stripping it", () => {
    // zod drops unknown keys by default; the previous detail schema omitted all
    // four price fields, so no amount ever reached the database.
    const { valid, invalid } = engine.mapReceptions([reception]);
    expect(invalid).toHaveLength(0);
    const line = valid[0]!.items[0]!;
    expect(line.receivedPrice).toBe(5000000);
    expect(line.remainPrice).toBe(1000.5);
    expect(line.discount).toBe(250000);
    expect(line.depositPrice).toBe(7.25);
  });

  it("rolls line items up into reception totals", () => {
    const twoLines = {
      ...reception,
      receptionDetailDtos: [
        reception.receptionDetailDtos[0]!,
        { ...reception.receptionDetailDtos[0]!, receivedPrice: 2000000, discount: 0 },
      ],
    };
    const { valid } = engine.mapReceptions([twoLines]);
    expect(valid[0]!.totals.totalReceived).toBe(7000000);
    expect(valid[0]!.totals.totalDiscount).toBe(250000);
    expect(valid[0]!.totals.itemCount).toBe(2);
  });

  it("treats a missing price as zero so SUM() stays correct", () => {
    const { valid } = engine.mapReceptions([
      {
        ...reception,
        receptionDetailDtos: [
          { secId: 1, srvId: 2, secName: "س", srvName: "خ", receptionPersonnelName: null },
        ],
      },
    ]);
    expect(valid[0]!.items[0]!.receivedPrice).toBe(0);
    expect(valid[0]!.totals.totalReceived).toBe(0);
  });

  it("assigns positional line numbers for a stable child key", () => {
    const { valid } = engine.mapReceptions([
      {
        ...reception,
        receptionDetailDtos: [
          reception.receptionDetailDtos[0]!,
          reception.receptionDetailDtos[0]!,
        ],
      },
    ]);
    expect(valid[0]!.items.map((i) => i.lineNo)).toEqual([0, 1]);
  });
});

describe("jalali conversion", () => {
  it("maps Nowruz anchors correctly", () => {
    expect(jalaliToDate("1404/01/01")!.toISOString().slice(0, 10)).toBe("2025-03-21");
    expect(jalaliToDate("1403/01/01")!.toISOString().slice(0, 10)).toBe("2024-03-20");
  });

  it("round-trips real CRM dates", () => {
    for (const j of ["1405/05/19", "1397/09/14", "1370/11/01"]) {
      expect(dateToJalali(jalaliToDate(j)!)).toBe(j);
    }
  });

  it("returns a bare date string for timezone-free persistence", () => {
    // A JS Date would be serialized in the process timezone, shifting the day
    // on any host west of UTC.
    expect(jalaliToSqlDate("1405/05/19")).toBe("2026-08-10");
  });

  it("degrades on the blank values the CRM emits", () => {
    expect(jalaliToSqlDate(" ")).toBeNull();
    expect(jalaliToSqlDate("")).toBeNull();
    expect(jalaliToSqlDate("0000/00/00")).toBeNull();
  });

  it("crosses the non-leap year boundary correctly", () => {
    // 1404 is not a leap year: Esfand has 29 days.
    expect(addJalaliDays("1404/12/29", 1)).toBe("1405/01/01");
    expect(addJalaliDays("1403/12/30", 1)).toBe("1404/01/01");
  });
});

describe("Persian numerals in date input", () => {
  // The Persian-locale date picker renders and emits Persian digits, so the UI
  // submitted `۱۴۰۵/۰۵/۲۱` (%DB%B1... once encoded) and the API rejected the
  // very value it had produced: JavaScript's \d matches ASCII only.
  it("converts Persian and Arabic-Indic digits to ASCII", () => {
    expect(toLatinDigits("۱۴۰۵/۰۵/۲۱")).toBe("1405/05/21");
    expect(toLatinDigits("١٤٠٥/٠٥/٢١")).toBe("1405/05/21");
    expect(toLatinDigits("1405/05/21")).toBe("1405/05/21");
  });

  it("parses a Jalali date written in Persian digits", () => {
    expect(parseJalali("۱۴۰۵/۰۵/۲۱")).toEqual({ jy: 1405, jm: 5, jd: 21 });
    expect(jalaliToSqlDate("۱۴۰۵/۰۵/۲۱")).toBe("2026-08-12");
  });

  it("accepts the exact query the date picker submits", () => {
    const parsed = financialRangeSchema.safeParse({ from: "۱۴۰۵/۰۵/۲۱", to: "۱۴۰۵/۰۵/۲۱" });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toEqual({ from: "1405/05/21", to: "1405/05/21" });
  });

  it("normalizes non-padded and cleared values", () => {
    const parsed = financialRangeSchema.safeParse({ from: "۱۴۰۵/۵/۲", to: "" });
    expect(parsed.success && parsed.data).toEqual({ from: "1405/05/02" });
  });

  it("still rejects genuine garbage with a readable message", () => {
    const parsed = financialRangeSchema.safeParse({ from: "not-a-date" });
    expect(parsed.success).toBe(false);
    expect(parsed.success === false && parsed.error.issues[0]!.message).toContain("شمسی");
  });
});

describe("date windowing", () => {
  it("tiles a range with no gaps or overlaps", () => {
    const windows = jalaliWindows("1404/01/01", "1404/12/29", 30);
    let cursor = "1404/01/01";
    for (const w of windows) {
      expect(w.from).toBe(cursor);
      cursor = addJalaliDays(w.to, 1);
    }
    expect(windows.at(-1)!.to).toBe("1404/12/29");
  });

  it("emits a single window when the range is shorter than the step", () => {
    expect(jalaliWindows("1404/01/01", "1404/01/02", 30)).toEqual([
      { from: "1404/01/01", to: "1404/01/02" },
    ]);
  });

  it("returns nothing when the range is inverted", () => {
    expect(jalaliWindows("1404/05/01", "1404/01/01", 7)).toEqual([]);
  });
});

/**
 * The scheduled refresh reads a narrow slice around today instead of the whole
 * dataset. These pin the two properties that make it cheap enough to run every
 * hour, and the one that makes it correct for reserves.
 */
describe("incremental sync range", () => {
  const today = "1404/06/15";

  it("stays small for the lookback slice", () => {
    const from = addJalaliDays(today, -7);
    const windows = jalaliWindows(from, today, 3);
    expect(windows.length).toBeLessThanOrEqual(3);
    expect(windows[0]!.from).toBe("1404/06/08");
    expect(windows.at(-1)!.to).toBe(today);
  });

  it("reaches past today for reserves, which are booked ahead", () => {
    const from = addJalaliDays(today, -7);
    const forwardTo = addJalaliDays(today, 30);
    const windows = jalaliWindows(from, forwardTo, 7);

    // Without the forward half of the range, tomorrow's appointments would
    // never be read at all — every other entity is only ever backdated.
    expect(windows.at(-1)!.to).toBe(forwardTo);
    expect(windows.some((w) => w.to > today)).toBe(true);
  });

  it("crosses a month boundary without skipping days", () => {
    const windows = jalaliWindows(addJalaliDays("1404/07/03", -7), "1404/07/03", 3);
    let cursor = "1404/06/27";
    for (const w of windows) {
      expect(w.from).toBe(cursor);
      cursor = addJalaliDays(w.to, 1);
    }
  });
});
