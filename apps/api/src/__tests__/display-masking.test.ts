import { describe, expect, it } from "vitest";
import { amountsHidden, crmRatesHidden, DEFAULT_DISPLAY_SETTINGS } from "@jordan/shared";
import { AMOUNT_FIELDS, maskFields } from "../lib/display-settings.js";
import { toCsv } from "../lib/csv.js";

describe("amountsHidden", () => {
  const hidden = { ...DEFAULT_DISPLAY_SETTINGS, hideAmounts: true };

  it("hides site-wide once the global switch is on", () => {
    expect(amountsHidden(hidden)).toBe(true);
    expect(amountsHidden(hidden, { scope: "crm" })).toBe(true);
  });

  it("exempts nobody, the superadmin included", () => {
    // The exemption used to live here and made the switch look broken to the
    // one person most likely to test it. The escape hatch is the switch itself.
    expect(amountsHidden(hidden, { isSuperadmin: true })).toBe(true);
    expect(crmRatesHidden({ ...hidden, hideCrmRates: true }, { isSuperadmin: true })).toBe(true);
  });

  it("keeps the CRM-only switch scoped to the CRM", () => {
    const crmOnly = { ...DEFAULT_DISPLAY_SETTINGS, hideCrmAmounts: true };
    expect(amountsHidden(crmOnly, { scope: "crm" })).toBe(true);
    expect(amountsHidden(crmOnly, { scope: "site" })).toBe(false);
  });

  it("shows everything when no switch is set", () => {
    expect(amountsHidden(DEFAULT_DISPLAY_SETTINGS)).toBe(false);
  });
});

describe("maskFields", () => {
  it("reaches money nested inside a JSON column", () => {
    // receptions.details_json is stored as the upstream CRM sends it, so the
    // per-line prices are only reachable by walking into it.
    const masked = maskFields(
      {
        receptionNo: 12,
        detailsJson: [{ srvName: "ویزیت", receivedPrice: 420000, discount: 0 }],
      },
      AMOUNT_FIELDS,
    );
    expect(masked).toEqual({
      receptionNo: 12,
      detailsJson: [{ srvName: "ویزیت", receivedPrice: null, discount: null }],
    });
  });

  it("leaves counts, rates and identifiers alone", () => {
    const row = { patientCount: 12, conversionRate: 0.4, patientExternalCode: 93864, visitCount: 3 };
    expect(maskFields(row, AMOUNT_FIELDS)).toEqual(row);
  });

  it("covers the money field names the reports actually return", () => {
    // A spot-check of the names that were leaking before the mask moved to
    // middleware — financial totals, doctor-report columns, per-patient worth.
    for (const field of [
      "totalReceived", "grossBilled", "received", "averagePerPatient",
      "revenueShare", "lifetimeSpend", "treatmentReceived", "amountText",
    ]) {
      expect(maskFields({ [field]: 1 }, AMOUNT_FIELDS)).toEqual({ [field]: null });
    }
  });
});

describe("toCsv money columns", () => {
  const rows = [{ name: "دکتر الف", received: 5_000_000, patients: 3 }];
  const columns = [
    { header: "پزشک", value: (r: (typeof rows)[number]) => r.name },
    { header: "درآمد (ریال)", value: (r: (typeof rows)[number]) => r.received, money: true },
    { header: "تعداد بیمار", value: (r: (typeof rows)[number]) => r.patients },
  ];

  it("drops the column rather than blanking it", () => {
    // A header with nothing under it invites someone to go looking for the
    // data that should have been there.
    const csv = toCsv(rows, columns, { hideMoney: true });
    const [header, row] = csv.replace(/^﻿/, "").trim().split("\r\n");
    expect(header).toBe("پزشک,تعداد بیمار");
    expect(row).toBe("دکتر الف,3");
    expect(csv).not.toContain("5000000");
  });

  it("keeps every column when nothing is hidden", () => {
    expect(toCsv(rows, columns).replace(/^﻿/, "").trim().split("\r\n")[0]).toBe(
      "پزشک,درآمد (ریال),تعداد بیمار",
    );
  });
});

describe("xlsx money columns", () => {
  it("drops money columns and summary rows when figures are hidden", async () => {
    const { addSheet, addSummarySheet, createWorkbook, FMT } = await import("../lib/xlsx.js");

    const rows = [{ name: "دکتر الف", received: 5_000_000, patients: 3 }];
    const columns = [
      { header: "نام پزشک", width: 20, align: "right" as const, value: (r: (typeof rows)[number]) => r.name },
      { header: "درآمد (ریال)", width: 16, value: (r: (typeof rows)[number]) => r.received, format: FMT.rial, money: true },
      { header: "بیمار", width: 10, value: (r: (typeof rows)[number]) => r.patients, format: FMT.count },
    ];

    const hidden = createWorkbook("t");
    addSheet(hidden, { name: "s", title: "t", columns, rows }, true);
    addSummarySheet(
      hidden,
      { name: "sum", title: "t", rows: [{ label: "درآمد", value: 5, money: true }, { label: "بیمار", value: 3 }] },
      true,
    );

    const sheet = hidden.getWorksheet("s")!;
    // Header row sits under the title bar; with no subtitle that is row 3.
    const headers = [1, 2, 3].map((c) => sheet.getCell(3, c).value);
    expect(headers).toEqual(["نام پزشک", "بیمار", null]);

    const summary = hidden.getWorksheet("sum")!;
    expect(summary.getCell(3, 1).value).toBe("بیمار");

    const shown = createWorkbook("t");
    addSheet(shown, { name: "s", title: "t", columns, rows }, false);
    expect(shown.getWorksheet("s")!.getCell(3, 2).value).toBe("درآمد (ریال)");
  });
});
