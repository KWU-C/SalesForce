import { describe, expect, it } from "vitest";
import type { MonthlyPerformance } from "./monthlyPerformance";
import { changeRate, cumulative, monthsWithoutWipTransfer, ratioToRevenue, sumValues } from "./performanceView";
import type { PerformanceMonth } from "./performanceView";

function perf(revenue: number | null, grossProfit: number | null, wip = true): MonthlyPerformance {
  return {
    revenue,
    grossProfit,
    sga: 0,
    operatingProfit: 0,
    nonOperatingIncome: 0,
    nonOperatingExpense: 0,
    ordinaryProfit: 0,
    laborCost: 0,
    outsourcingCost: 0,
    manufacturingConsignmentCost: 0,
    buildingCost: 0,
    buildingLines: [],
    buildingCandidateUnassigned: 0,
    motherExpense: 0,
    motherLines: [],
    wipTransferDetected: wip,
  };
}

describe("performanceView", () => {
  it("累計は1か月でも欠けていればnull(欠けた月を0円として足さない)", () => {
    expect(sumValues([1, 2, 3])).toBe(6);
    expect(sumValues([1, null])).toBeNull();
    expect(sumValues([])).toBeNull();
    const months: PerformanceMonth[] = [
      { month: 9, current: perf(100, 30), previous: perf(80, 20) },
      { month: 10, current: perf(200, -10), previous: null },
    ];
    expect(cumulative(months, "revenue", "current")).toBe(300);
    expect(cumulative(months, "grossProfit", "current")).toBe(20);
    expect(cumulative(months, "revenue", "previous")).toBeNull();
  });

  it("比率は符号付き。売上0・未取得はnull", () => {
    expect(ratioToRevenue(-50, 200)).toBe(-25);
    expect(ratioToRevenue(10, 0)).toBeNull();
    expect(ratioToRevenue(null, 100)).toBeNull();
  });

  it("前年比の増減率は前年の絶対値で割る(前年が赤字でも改善がプラス)", () => {
    expect(changeRate(120, 100)).toBe(20);
    expect(changeRate(-50, -100)).toBe(50);
    expect(changeRate(10, 0)).toBeNull();
  });

  it("仕掛品振替が未検出の当期の月だけを返す(未取得の月は含めない)", () => {
    const months: PerformanceMonth[] = [
      { month: 9, current: perf(1, 1, true), previous: null },
      { month: 10, current: perf(1, 1, false), previous: null },
      { month: 11, current: null, previous: null },
    ];
    expect(monthsWithoutWipTransfer(months)).toEqual([10]);
  });
});
