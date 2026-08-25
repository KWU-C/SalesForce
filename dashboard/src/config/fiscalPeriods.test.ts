import { describe, expect, it } from "vitest";
import { fiscalTermDateRange, getAdjacentTerms, getCurrentFiscalPeriod } from "./fiscalPeriods";

describe("getCurrentFiscalPeriod", () => {
  it("returns 49期・8月 for 2026-08-06 (today at time of writing)", () => {
    expect(getCurrentFiscalPeriod(new Date(2026, 7, 6))).toEqual({ term: 49, currentMonth: 8 });
  });

  it("returns 49期・9月 for the first day of the fiscal year (2025-09-01)", () => {
    expect(getCurrentFiscalPeriod(new Date(2025, 8, 1))).toEqual({ term: 49, currentMonth: 9 });
  });

  it("rolls over to 50期 on 2026-09-01 (fiscal year start)", () => {
    expect(getCurrentFiscalPeriod(new Date(2026, 8, 1))).toEqual({ term: 50, currentMonth: 9 });
  });

  it("stays in 49期 through the last day of the fiscal year (2026-08-31)", () => {
    expect(getCurrentFiscalPeriod(new Date(2026, 7, 31))).toEqual({ term: 49, currentMonth: 8 });
  });

  it("rolls forward multiple fiscal years correctly (2027-09-01 => 51期)", () => {
    expect(getCurrentFiscalPeriod(new Date(2027, 8, 1))).toEqual({ term: 51, currentMonth: 9 });
  });
});

describe("getAdjacentTerms", () => {
  it("returns [50, 49, 48] (next, current, previous) when today is in 49期", () => {
    expect(getAdjacentTerms(new Date(2026, 7, 6))).toEqual([50, 49, 48]);
  });

  it("returns [51, 50, 49] right after rolling over to 50期", () => {
    expect(getAdjacentTerms(new Date(2026, 8, 1))).toEqual([51, 50, 49]);
  });
});

describe("fiscalTermDateRange", () => {
  it("returns 2025-09-01〜2026-08-31 for 49期", () => {
    expect(fiscalTermDateRange(49)).toEqual({ start: "2025-09-01", end: "2026-08-31" });
  });

  it("returns 2026-09-01〜2027-08-31 for 50期", () => {
    expect(fiscalTermDateRange(50)).toEqual({ start: "2026-09-01", end: "2027-08-31" });
  });
});
