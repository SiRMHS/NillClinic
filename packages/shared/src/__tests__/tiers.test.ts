import { describe, expect, it } from "vitest";
import {
  jalaliYearRange,
  rialToToman,
  tierSettingsUpdateSchema,
  tomanToRial,
} from "../index.js";

describe("tier thresholds", () => {
  it("converts the clinic's Toman bands to the Rial the schema stores", () => {
    // ۱ میلیارد تومان — the PLATINUM floor as the clinic states it.
    expect(tomanToRial(1_000_000_000)).toBe(10_000_000_000);
    expect(rialToToman(10_000_000_000)).toBe(1_000_000_000);
  });

  it("accepts the clinic's own bands", () => {
    expect(
      tierSettingsUpdateSchema.parse({
        platinumMin: 10_000_000_000,
        goldMin: 6_000_000_000,
        silverMin: 3_000_000_000,
        bronzeMin: 1_000_000_000,
      }),
    ).toMatchObject({ bronzeMin: 1_000_000_000 });
  });

  it("rejects bands that do not strictly descend", () => {
    // SILVER at or below BRONZE makes SILVER unreachable, which shows up as an
    // empty tier rather than as the configuration error it is.
    const result = tierSettingsUpdateSchema.safeParse({
      platinumMin: 10_000_000_000,
      goldMin: 6_000_000_000,
      silverMin: 1_000_000_000,
      bronzeMin: 1_000_000_000,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a zero bronze floor, which would put every payer in BRONZE", () => {
    expect(
      tierSettingsUpdateSchema.safeParse({
        platinumMin: 10_000_000_000,
        goldMin: 6_000_000_000,
        silverMin: 3_000_000_000,
        bronzeMin: 0,
      }).success,
    ).toBe(false);
  });
});

describe("jalaliYearRange", () => {
  it("spans فروردین to اسفند of the year the date falls in", () => {
    expect(jalaliYearRange("1405/06/11")).toEqual({ from: "1405/01/01", to: "1405/12/30" });
  });

  it("keeps a date on the first day of the year inside its own year", () => {
    expect(jalaliYearRange("1404/01/01")).toEqual({ from: "1404/01/01", to: "1404/12/30" });
  });
});
