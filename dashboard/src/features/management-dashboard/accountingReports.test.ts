import { describe, expect, it } from "vitest";
import {
  checkCashPlan,
  difference,
  parseReportValues,
  sortByTargetMonthDesc,
  targetMonthLabel,
  targetMonthPeriod,
  type CashPlanValues,
} from "./accountingReports";

// 金額はすべて架空の値(実額はFirestoreにだけ置く)
function cashPlan(overrides: Partial<CashPlanValues> = {}): CashPlanValues {
  return {
    checkingSavingsTotal: 600,
    timeDepositTotal: 300,
    collateralDeduction: 500,
    depositTotalAfterCollateral: 400,
    consumptionTaxReserve: 20,
    bonusReserve: 80,
    checkingSavingsAfterReserves: 500,
    depositTotalAfterReserves: 300,
    sourceUpdatedOn: "2026-10-14",
    documentName: "資金繰り",
    note: null,
    ...overrides,
  };
}

describe("parseReportValues", () => {
  const monthly = {
    revenueCumulative: 1000,
    ordinaryProfitCumulative: -50,
    basisDate: "2026-09-30",
    documentName: "経理報告",
  };

  it("accepts a monthly report and fills omitted optional fields with null (dates are not guessed)", () => {
    expect(parseReportValues("monthly-report", monthly)).toEqual({
      revenueCumulative: 1000,
      ordinaryProfitCumulative: -50,
      prevYearRevenueCumulative: null,
      prevYearOrdinaryProfitCumulative: null,
      basisDate: "2026-09-30",
      reportDate: null,
      documentName: "経理報告",
      differenceExplanation: null,
      note: null,
    });
  });

  it.each([
    ["unknown field", { ...monthly, extra: 1 }],
    ["missing document name", { ...monthly, documentName: "  " }],
    ["fractional amount", { ...monthly, revenueCumulative: 1.5 }],
    ["string amount", { ...monthly, revenueCumulative: "1000" }],
    ["impossible date", { ...monthly, basisDate: "2026-02-30" }],
    ["no amounts at all", { documentName: "経理報告" }],
    ["not an object", "x"],
  ])("rejects %s", (_label, raw) => {
    expect(parseReportValues("monthly-report", raw)).toBeNull();
  });

  it("rejects negative reserves and collateral in a cash plan but allows negative balances", () => {
    const { documentName, sourceUpdatedOn, ...amounts } = cashPlan();
    const base = { ...amounts, documentName, sourceUpdatedOn };
    expect(parseReportValues("cash-plan", base)).not.toBeNull();
    expect(parseReportValues("cash-plan", { ...base, bonusReserve: -1 })).toBeNull();
    expect(parseReportValues("cash-plan", { ...base, collateralDeduction: -1 })).toBeNull();
    expect(parseReportValues("cash-plan", { ...base, depositTotalAfterReserves: -10 })).not.toBeNull();
  });
});

describe("checkCashPlan", () => {
  it("passes when the document's figures add up", () => {
    expect(checkCashPlan(cashPlan()).map((c) => c.difference)).toEqual([0, 0, 0]);
  });

  it("reports the gap without changing any figure", () => {
    const plan = cashPlan({ depositTotalAfterCollateral: 410, timeDepositTotal: 300 });
    const checks = checkCashPlan(plan);
    expect(checks[0].difference).toBe(10);
    expect(checks[2].difference).toBe(-10);
    expect(plan.depositTotalAfterCollateral).toBe(410);
  });

  it("cannot check when a figure is missing", () => {
    expect(checkCashPlan(cashPlan({ timeDepositTotal: null }))[0].difference).toBeNull();
  });
});

describe("helpers", () => {
  it("maps a target month to the term and freee fiscal year", () => {
    expect(targetMonthPeriod("2026-09")).toEqual({ term: 50, fiscalYear: 2026, month: 9 });
    expect(targetMonthPeriod("2026-08")).toEqual({ term: 49, fiscalYear: 2025, month: 8 });
    expect(targetMonthLabel("2027-01")).toBe("50期1月");
  });

  it("returns null difference when either side is missing", () => {
    expect(difference(100, 70)).toBe(30);
    expect(difference(100, null)).toBeNull();
    expect(difference(null, 70)).toBeNull();
    expect(difference(100, undefined)).toBeNull();
  });

  it("sorts newest target month first", () => {
    expect(sortByTargetMonthDesc([{ targetMonth: "2026-09" }, { targetMonth: "2026-11" }, { targetMonth: "2025-12" }])).toEqual([
      { targetMonth: "2026-11" },
      { targetMonth: "2026-09" },
      { targetMonth: "2025-12" },
    ]);
  });
});
