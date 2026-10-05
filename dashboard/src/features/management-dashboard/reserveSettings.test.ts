import { describe, expect, it } from "vitest";
import { overdraftLimitTotal, parseReserveSettings, selectReserveSettings } from "./reserveSettings";
import type { ManagementReserveSettings } from "./reserveSettings";

function settings(asOf: string, overrides: Partial<ManagementReserveSettings> = {}): ManagementReserveSettings {
  return { asOf, consumptionTaxReserve: 75, bonusReserve: 90, overdraftLimits: [], source: null, ...overrides };
}

describe("parseReserveSettings", () => {
  it("accepts a well-formed document", () => {
    expect(
      parseReserveSettings({
        asOf: "2026-10-05",
        consumptionTaxReserve: 75,
        bonusReserve: 90,
        overdraftLimits: [{ lender: "A", limit: 300 }],
        source: "残高表",
        updatedBy: "someone@example.com",
      })
    ).toEqual({
      asOf: "2026-10-05",
      consumptionTaxReserve: 75,
      bonusReserve: 90,
      overdraftLimits: [{ lender: "A", limit: 300 }],
      source: "残高表",
    });
  });

  it.each([[null], ["text"], [{}], [{ asOf: "2026/10/05" }], [{ asOf: 20261005 }]])(
    "rejects a document without a readable asOf: %j",
    (data) => {
      expect(parseReserveSettings(data)).toBeNull();
    }
  );

  it("treats non-numeric or negative amounts as not entered (null), keeping the rest", () => {
    const parsed = parseReserveSettings({
      asOf: "2026-10-05",
      consumptionTaxReserve: "7500000",
      bonusReserve: -1,
      overdraftLimits: [{ lender: "A", limit: "300" }, { limit: 500 }, { lender: "B", limit: 500 }],
    });
    expect(parsed).toMatchObject({
      consumptionTaxReserve: null,
      bonusReserve: null,
      overdraftLimits: [{ lender: "B", limit: 500 }],
    });
  });

  it("keeps an explicit 0 as an entered value", () => {
    expect(parseReserveSettings({ asOf: "2026-10-05", bonusReserve: 0 })?.bonusReserve).toBe(0);
  });
});

describe("selectReserveSettings", () => {
  const all = [settings("2026-09-30"), settings("2026-10-05"), settings("2026-11-02")];

  it("picks the latest settings dated on or before the month end", () => {
    expect(selectReserveSettings(all, 2026, 10)?.asOf).toBe("2026-10-05");
    expect(selectReserveSettings(all, 2026, 11)?.asOf).toBe("2026-11-02");
  });

  it("uses the month end as the boundary (9月 = 9/30まで)", () => {
    expect(selectReserveSettings(all, 2026, 9)?.asOf).toBe("2026-09-30");
  });

  it("does not apply later settings back to an earlier month", () => {
    expect(selectReserveSettings([settings("2026-10-05")], 2026, 9)).toBeNull();
  });

  it("maps months 1-8 to the following calendar year of the fiscal year (9月始まり)", () => {
    const next = [settings("2027-02-28"), settings("2027-03-01")];
    expect(selectReserveSettings(next, 2026, 2)?.asOf).toBe("2027-02-28");
    expect(selectReserveSettings(next, 2026, 8)?.asOf).toBe("2027-03-01");
    expect(selectReserveSettings(next, 2026, 12)).toBeNull();
  });

  it("returns null when there are no settings", () => {
    expect(selectReserveSettings([], 2026, 10)).toBeNull();
  });
});

describe("overdraftLimitTotal", () => {
  it("sums the limits", () => {
    const s = settings("2026-10-05", { overdraftLimits: [{ lender: "A", limit: 300 }, { lender: "B", limit: 500 }] });
    expect(overdraftLimitTotal(s)).toBe(800);
  });

  it("is null (not 0) when nothing is entered", () => {
    expect(overdraftLimitTotal(settings("2026-10-05"))).toBeNull();
    expect(overdraftLimitTotal(null)).toBeNull();
  });
});
