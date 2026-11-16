import { describe, expect, it } from "vitest";
import {
  actualKindsDifference,
  changesOnlyNote,
  checkCashPlan,
  compareCashPlan,
  difference,
  monthEndBoundary,
  resolveCashPlanActual,
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

  it("returns freee minus accounting, or null when either side is missing", () => {
    expect(difference(100, 70)).toBe(30);
    expect(difference(70, 100)).toBe(-30);
    expect(difference(100, null)).toBeNull();
    expect(difference(null, 70)).toBeNull();
    expect(difference(undefined, 70)).toBeNull();
  });

  it("sorts newest target month first", () => {
    expect(sortByTargetMonthDesc([{ targetMonth: "2026-09" }, { targetMonth: "2026-11" }, { targetMonth: "2025-12" }])).toEqual([
      { targetMonth: "2026-11" },
      { targetMonth: "2026-09" },
      { targetMonth: "2025-12" },
    ]);
  });
});

describe("changesOnlyNote", () => {
  it("allows only the note to differ (null and missing are the same)", () => {
    const base = { revenueCumulative: 1, ordinaryProfitCumulative: -1, documentName: "経理報告", note: null };
    expect(changesOnlyNote(base, { ...base, note: "確認事項" })).toBe(true);
    expect(changesOnlyNote(base, { ...base, ordinaryProfitCumulative: -2, note: "確認事項" })).toBe(false);
    expect(changesOnlyNote(base, { ...base, differenceExplanation: "説明" })).toBe(false);
    expect(changesOnlyNote({ ...base, basisDate: null }, base)).toBe(true);
  });
});

describe("cash plan vs freee month-end actual", () => {
  const snapshot = (overrides: Record<string, unknown> = {}) => ({
    cashClosing: 1_005,
    checkingSavingsClosing: 650,
    timeDepositClosing: 350,
    cashOnHandClosing: 5,
    fetchedAt: new Date("2026-11-01T09:00:00Z"),
    ...overrides,
  });

  it("treats the month as ended from the 1st of the next month, 0:00 JST", () => {
    expect(monthEndBoundary("2026-10").toISOString()).toBe("2026-10-31T15:00:00.000Z");
    expect(monthEndBoundary("2026-12").toISOString()).toBe("2026-12-31T15:00:00.000Z");
  });

  it("is before month end until the boundary", () => {
    expect(resolveCashPlanActual("2026-10", snapshot(), new Date("2026-10-31T14:59:59Z"))).toEqual({ status: "beforeMonthEnd" });
  });

  it("is not fetched when the snapshot is missing, fetched before month end, or lacks the new fields (never 0)", () => {
    const now = new Date("2026-11-02T00:00:00Z");
    expect(resolveCashPlanActual("2026-10", null, now)).toEqual({ status: "notFetched" });
    expect(resolveCashPlanActual("2026-10", snapshot({ fetchedAt: new Date("2026-10-31T09:00:00Z") }), now)).toEqual({
      status: "notFetched",
    });
    expect(resolveCashPlanActual("2026-10", snapshot({ timeDepositClosing: undefined }), now)).toEqual({ status: "notFetched" });
    expect(resolveCashPlanActual("2026-10", snapshot({ cashClosing: null }), now)).toEqual({ status: "notFetched" });
  });

  it("compares checking/savings, time deposits and their total as freee minus accounting, leaving cash on hand out", () => {
    const actual = resolveCashPlanActual("2026-10", snapshot(), new Date("2026-11-02T00:00:00Z"));
    expect(actual).toMatchObject({ status: "fetched", fetchedAt: "2026-11-01T09:00:00.000Z" });
    expect(compareCashPlan(cashPlan(), actual)).toEqual([
      { label: "当座・普通預金", planned: 600, actual: 650, difference: 50 },
      { label: "定期預金", planned: 300, actual: 350, difference: 50 },
      { label: "預金合計（担保控除前）", planned: 900, actual: 1_000, difference: 100 },
    ]);
    if (actual.status === "fetched") expect(actualKindsDifference(actual)).toBe(0);
  });

  it("has no actual or difference before the data is there, and no planned total when an item is missing", () => {
    const rows = compareCashPlan(cashPlan({ timeDepositTotal: null }), { status: "notFetched" });
    expect(rows.map((r) => [r.planned, r.actual, r.difference])).toEqual([
      [600, null, null],
      [null, null, null],
      [null, null, null],
    ]);
  });

  it("reports the gap between cashClosing and the kinds", () => {
    const actual = resolveCashPlanActual("2026-10", snapshot({ cashClosing: 1_075 }), new Date("2026-11-02T00:00:00Z"));
    if (actual.status !== "fetched") throw new Error("expected fetched");
    expect(actualKindsDifference(actual)).toBe(70);
  });
});
