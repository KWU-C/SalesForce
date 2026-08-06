import { describe, expect, it } from "vitest";
import { getCurrentFiscalPeriod } from "./fiscalPeriods";

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
