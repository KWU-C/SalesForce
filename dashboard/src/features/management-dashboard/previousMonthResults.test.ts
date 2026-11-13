import { describe, expect, it } from "vitest";
import type { MonthlyPerformanceSnapshot } from "./monthlyPerformance";
import type { MonthEndCashSnapshot } from "./accountingReports";
import {
  previousMonthInJst,
  summarizePreviousMonthCash,
  summarizePreviousMonthPerformance,
} from "./previousMonthResults";
import type { PerformanceLookup } from "./previousMonthResults";

// 金額はすべて架空の値

function snapshot(
  fiscalYear: number,
  month: number,
  values: { revenue: number | null; ordinaryProfit: number | null; wip?: boolean },
  fetchedAt: string
): MonthlyPerformanceSnapshot {
  return {
    fiscalYear,
    month,
    fetchedAt: new Date(fetchedAt),
    calculationVersion: 1,
    revenue: values.revenue,
    grossProfit: null,
    sga: null,
    operatingProfit: 999_999, // 経常利益の代わりに使われないことの確認用
    nonOperatingIncome: null,
    nonOperatingExpense: null,
    ordinaryProfit: values.ordinaryProfit,
    laborCost: null,
    outsourcingCost: null,
    manufacturingConsignmentCost: null,
    buildingCost: 0,
    buildingLines: [],
    buildingCandidateUnassigned: 0,
    motherExpense: 0,
    motherLines: [],
    wipTransferDetected: values.wip ?? true,
  };
}

function lookupOf(snapshots: MonthlyPerformanceSnapshot[]): PerformanceLookup {
  return (fy, month) => snapshots.find((s) => s.fiscalYear === fy && s.month === month) ?? null;
}

describe("previousMonthInJst", () => {
  it("日本時間の前月を返す(UTCでは前日でも、日本時間で月が替わっていれば前月は替わる)", () => {
    // 2026-11-01 00:30 JST = 2026-10-31 15:30 UTC
    const t = previousMonthInJst(new Date("2026-10-31T15:30:00Z"));
    expect(t).toMatchObject({ term: 50, fiscalYear: 2026, month: 10, calendarYear: 2026, key: "2026-10" });
    // 2026-10-31 23:59 JST はまだ10月 → 前月は9月
    expect(previousMonthInJst(new Date("2026-10-31T14:59:00Z")).month).toBe(9);
  });

  it("9月(期首)の前月は前期の8月", () => {
    const t = previousMonthInJst(new Date("2026-09-10T03:00:00Z"));
    expect(t).toMatchObject({ term: 49, fiscalYear: 2025, month: 8, calendarYear: 2026, key: "2026-08" });
  });

  it("1月の前月は前年12月(同じ期)", () => {
    const t = previousMonthInJst(new Date("2027-01-05T03:00:00Z"));
    expect(t).toMatchObject({ term: 50, fiscalYear: 2026, month: 12, calendarYear: 2026, key: "2026-12" });
  });
});

describe("summarizePreviousMonthPerformance", () => {
  const target = previousMonthInJst(new Date("2026-11-13T03:00:00Z")); // 50期 10月
  const after = "2026-11-12T09:00:00Z"; // 両月とも月末後の取得

  it("期首から対象月までの単月値を合計し、前年同期(同じ月数)と増減額を出す。経常利益は営業利益で代用しない", () => {
    const result = summarizePreviousMonthPerformance(
      target,
      lookupOf([
        snapshot(2026, 9, { revenue: 1000, ordinaryProfit: -300 }, after),
        snapshot(2026, 10, { revenue: 500, ordinaryProfit: 100 }, after),
        snapshot(2025, 9, { revenue: 800, ordinaryProfit: -500 }, "2025-10-05T00:00:00Z"),
        snapshot(2025, 10, { revenue: 0, ordinaryProfit: -100 }, "2025-11-05T00:00:00Z"),
        snapshot(2025, 11, { revenue: 99_999, ordinaryProfit: 99_999 }, "2025-12-05T00:00:00Z"), // 範囲外
      ])
    );
    expect(result.months).toEqual([9, 10]);
    expect(result.revenue).toEqual({ current: 1500, previous: 800, change: 700 });
    // 前年が赤字でも増減額で読める(−200 − (−600) = +400)
    expect(result.ordinaryProfit).toEqual({ current: -200, previous: -600, change: 400 });
    expect(result.missingMonths).toEqual([]);
    expect(result.fetchedFrom?.toISOString()).toBe(new Date(after).toISOString());
  });

  it("月末前に取得した月は欠けとして扱い、累計を出さない(0円とみなさない)", () => {
    const result = summarizePreviousMonthPerformance(
      target,
      lookupOf([
        snapshot(2026, 9, { revenue: 1000, ordinaryProfit: 10 }, after),
        snapshot(2026, 10, { revenue: 500, ordinaryProfit: 10 }, "2026-10-31T09:00:00Z"), // 10月末18時JST=月末前
        snapshot(2025, 9, { revenue: 800, ordinaryProfit: 10 }, "2025-10-05T00:00:00Z"),
        snapshot(2025, 10, { revenue: 700, ordinaryProfit: 10 }, "2025-11-05T00:00:00Z"),
      ])
    );
    expect(result.missingMonths).toEqual([10]);
    expect(result.revenue).toEqual({ current: null, previous: 1500, change: null });
  });

  it("前年同期に保存の無い月があれば前年同期と増減額は未取得", () => {
    const result = summarizePreviousMonthPerformance(
      target,
      lookupOf([
        snapshot(2026, 9, { revenue: 1000, ordinaryProfit: 10 }, after),
        snapshot(2026, 10, { revenue: 0, ordinaryProfit: 0 }, after),
        snapshot(2025, 9, { revenue: 800, ordinaryProfit: 10 }, "2025-10-05T00:00:00Z"),
      ])
    );
    expect(result.revenue).toEqual({ current: 1000, previous: null, change: null });
    expect(result.ordinaryProfit.current).toBe(10); // 0円の月は0円として合計する
    expect(result.previousMissingMonths).toEqual([10]);
  });

  it("項目がnullの月があれば、その項目の累計は出さない", () => {
    const result = summarizePreviousMonthPerformance(
      target,
      lookupOf([
        snapshot(2026, 9, { revenue: 1000, ordinaryProfit: null }, after),
        snapshot(2026, 10, { revenue: 500, ordinaryProfit: 10 }, after),
      ])
    );
    expect(result.revenue.current).toBe(1500);
    expect(result.ordinaryProfit.current).toBeNull();
  });

  it("仕掛品振替が未検出の月は対象期間の月だけを返す", () => {
    const result = summarizePreviousMonthPerformance(
      target,
      lookupOf([
        snapshot(2026, 9, { revenue: 1, ordinaryProfit: 1, wip: true }, after),
        snapshot(2026, 10, { revenue: 1, ordinaryProfit: 1, wip: false }, after),
        snapshot(2026, 11, { revenue: 1, ordinaryProfit: 1, wip: false }, after),
      ])
    );
    expect(result.noWipTransferMonths).toEqual([10]);
  });

  it("9月に開いたときは前期12か月の累計と、前々期12か月を比べる", () => {
    const t = previousMonthInJst(new Date("2026-09-10T03:00:00Z")); // 49期8月
    const months = [9, 10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8];
    const fetched = (fy: number) => `${fy + 1}-09-05T00:00:00Z`;
    const result = summarizePreviousMonthPerformance(
      t,
      lookupOf([
        ...months.map((m) => snapshot(2025, m, { revenue: 10, ordinaryProfit: 1 }, fetched(2025))),
        ...months.map((m) => snapshot(2024, m, { revenue: 7, ordinaryProfit: -1 }, fetched(2024))),
      ])
    );
    expect(result.months).toEqual(months);
    expect(result.revenue).toEqual({ current: 120, previous: 84, change: 36 });
    expect(result.ordinaryProfit).toEqual({ current: 12, previous: -12, change: 24 });
  });
});

describe("summarizePreviousMonthCash", () => {
  const target = previousMonthInJst(new Date("2026-11-13T03:00:00Z")); // 2026-10
  const now = new Date("2026-11-13T03:00:00Z");
  const base: MonthEndCashSnapshot = {
    cashClosing: 1_000 + 300 + 7,
    checkingSavingsClosing: 1_000,
    timeDepositClosing: 300,
    cashOnHandClosing: 7,
    fetchedAt: new Date("2026-11-01T09:00:00Z"),
  };

  it("当座・普通は定期・小口現金を含まない。担保控除額が無ければ控除後は未設定(控除前で代用しない)", () => {
    const result = summarizePreviousMonthCash(target, base, { amount: null }, now);
    expect(result).toMatchObject({
      status: "fetched",
      checkingSavings: 1_000,
      timeDeposit: 300,
      depositTotalBeforeCollateral: 1_300,
      depositTotalAfterCollateral: null,
      kindsDifference: 0,
    });
  });

  it("担保控除額があれば 当座・普通 + 定期 − 担保控除。消費税・賞与準備は引かない", () => {
    const result = summarizePreviousMonthCash(target, base, { amount: 200 }, now);
    expect(result).toMatchObject({ status: "fetched", depositTotalAfterCollateral: 1_100 });
  });

  it("月末前に取得したスナップショットは月末実績にしない", () => {
    const result = summarizePreviousMonthCash(
      target,
      { ...base, fetchedAt: new Date("2026-10-31T09:00:00Z") },
      { amount: null },
      now
    );
    expect(result.status).toBe("notFetched");
  });

  it("種類別の残高が無い保存分・スナップショットなしは未取得", () => {
    expect(summarizePreviousMonthCash(target, { ...base, timeDepositClosing: undefined }, { amount: null }, now).status).toBe(
      "notFetched"
    );
    expect(summarizePreviousMonthCash(target, null, { amount: null }, now).status).toBe("notFetched");
  });
});
