import { describe, expect, it } from "vitest";
import type { MonthlyPerformanceSnapshot } from "./monthlyPerformance";
import type { MonthEndCashSnapshot } from "./accountingReports";
import {
  previousMonthInJst,
  nextTargetMonth,
  selectCashPlanOutlook,
  summarizePerformanceColumn,
  summarizePreviousMonthCash,
  targetMonth,
} from "./overviewComparison";
import type { PerformanceLookup } from "./overviewComparison";

// 金額はすべて架空の値

type Values = { revenue: number | null; grossProfit?: number | null; operatingProfit?: number | null; ordinaryProfit: number | null; wip?: boolean };

function snapshot(fiscalYear: number, month: number, values: Values, fetchedAt: string): MonthlyPerformanceSnapshot {
  return {
    fiscalYear,
    month,
    fetchedAt: new Date(fetchedAt),
    calculationVersion: 1,
    revenue: values.revenue,
    grossProfit: values.grossProfit ?? 0,
    sga: null,
    operatingProfit: values.operatingProfit ?? 999_999,
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

const NO_COLLATERAL = { amount: null, asOf: null, source: null };

describe("previousMonthInJst", () => {
  it("日本時間の前月を返す(UTCでは前日でも、日本時間で月が替わっていれば前月は替わる)", () => {
    // 2026-11-01 00:30 JST = 2026-10-31 15:30 UTC
    expect(previousMonthInJst(new Date("2026-10-31T15:30:00Z"))).toMatchObject({
      term: 50,
      fiscalYear: 2026,
      month: 10,
      calendarYear: 2026,
      key: "2026-10",
    });
    // 2026-10-31 23:59 JST はまだ10月 → 前月は9月
    expect(previousMonthInJst(new Date("2026-10-31T14:59:00Z")).month).toBe(9);
  });

  it("9月(期首)の前月は前期の8月", () => {
    expect(previousMonthInJst(new Date("2026-09-10T03:00:00Z"))).toMatchObject({
      term: 49,
      fiscalYear: 2025,
      month: 8,
      calendarYear: 2026,
      key: "2026-08",
    });
  });

  it("1月の前月は前年12月(同じ期)", () => {
    expect(previousMonthInJst(new Date("2027-01-05T03:00:00Z"))).toMatchObject({ term: 50, month: 12, calendarYear: 2026 });
  });
});

describe("summarizePerformanceColumn", () => {
  const october = targetMonth(50, 10);
  const after = "2026-11-12T09:00:00Z"; // 両月とも月末後の取得

  it("4指標を期首から対象月までの単月合計で出し、前年同期(同じ月数)と増減額を出す。経常利益は営業利益で代用しない", () => {
    const column = summarizePerformanceColumn(
      october,
      lookupOf([
        snapshot(2026, 9, { revenue: 1000, grossProfit: 400, operatingProfit: 50, ordinaryProfit: -300 }, after),
        snapshot(2026, 10, { revenue: 500, grossProfit: 100, operatingProfit: -20, ordinaryProfit: 100 }, after),
        snapshot(2025, 9, { revenue: 800, grossProfit: 300, operatingProfit: 10, ordinaryProfit: -500 }, "2025-10-05T00:00:00Z"),
        snapshot(2025, 10, { revenue: 0, grossProfit: 0, operatingProfit: 0, ordinaryProfit: -100 }, "2025-11-05T00:00:00Z"),
        snapshot(2025, 11, { revenue: 99_999, ordinaryProfit: 99_999 }, "2025-12-05T00:00:00Z"), // 範囲外
      ]),
      { requireMonthEnd: true }
    );
    expect(column.months).toEqual([9, 10]);
    expect(column.amounts.revenue).toEqual({ current: 1500, previous: 800, change: 700 });
    expect(column.amounts.grossProfit).toEqual({ current: 500, previous: 300, change: 200 });
    expect(column.amounts.operatingProfit).toEqual({ current: 30, previous: 10, change: 20 });
    // 前年が赤字でも増減額で読める(−200 − (−600) = +400)
    expect(column.amounts.ordinaryProfit).toEqual({ current: -200, previous: -600, change: 400 });
    expect(column.missingMonths).toEqual([]);
  });

  it("実績は月末前に取得した月を欠けとして扱い累計を出さない。速報は取得時点の値をそのまま使う", () => {
    const snapshots = [
      snapshot(2026, 9, { revenue: 1000, ordinaryProfit: 10 }, after),
      snapshot(2026, 10, { revenue: 500, ordinaryProfit: 10 }, "2026-10-31T09:00:00Z"), // 10月末18時JST=月末前
      snapshot(2025, 9, { revenue: 800, ordinaryProfit: 10 }, "2025-10-05T00:00:00Z"),
      snapshot(2025, 10, { revenue: 700, ordinaryProfit: 10 }, "2025-11-05T00:00:00Z"),
    ];
    const actual = summarizePerformanceColumn(october, lookupOf(snapshots), { requireMonthEnd: true });
    expect(actual.missingMonths).toEqual([10]);
    expect(actual.amounts.revenue).toEqual({ current: null, previous: 1500, change: null });
    const flash = summarizePerformanceColumn(october, lookupOf(snapshots), { requireMonthEnd: false });
    expect(flash.amounts.revenue.current).toBe(1500);
    expect(flash.fetchedFrom?.toISOString()).toBe("2026-10-31T09:00:00.000Z");
    expect(flash.fetchedTo?.toISOString()).toBe(new Date(after).toISOString());
  });

  it("前年同期の欠けは当期の欠けと区別し、0円の月は0円として合計する", () => {
    const column = summarizePerformanceColumn(
      october,
      lookupOf([
        snapshot(2026, 9, { revenue: 1000, ordinaryProfit: 10 }, after),
        snapshot(2026, 10, { revenue: 0, ordinaryProfit: 0 }, after),
        snapshot(2025, 9, { revenue: 800, ordinaryProfit: 10 }, "2025-10-05T00:00:00Z"),
      ]),
      { requireMonthEnd: true }
    );
    expect(column.amounts.revenue).toEqual({ current: 1000, previous: null, change: null });
    expect(column.missingMonths).toEqual([]);
    expect(column.previousMissingMonths).toEqual([10]);
  });

  it("項目がnullの月があれば、その項目の累計だけ出さない", () => {
    const column = summarizePerformanceColumn(
      october,
      lookupOf([
        snapshot(2026, 9, { revenue: 1000, ordinaryProfit: null }, after),
        snapshot(2026, 10, { revenue: 500, ordinaryProfit: 10 }, after),
      ]),
      { requireMonthEnd: true }
    );
    expect(column.amounts.revenue.current).toBe(1500);
    expect(column.amounts.ordinaryProfit.current).toBeNull();
  });

  it("仕掛品振替が未検出の月は、その列の対象期間の月だけを返す", () => {
    const snapshots = [
      snapshot(2026, 9, { revenue: 1, ordinaryProfit: 1, wip: true }, after),
      snapshot(2026, 10, { revenue: 1, ordinaryProfit: 1, wip: false }, after),
      snapshot(2026, 11, { revenue: 1, ordinaryProfit: 1, wip: false }, after),
    ];
    expect(summarizePerformanceColumn(october, lookupOf(snapshots), { requireMonthEnd: true }).noWipTransferMonths).toEqual([10]);
    expect(
      summarizePerformanceColumn(targetMonth(50, 11), lookupOf(snapshots), { requireMonthEnd: false }).noWipTransferMonths
    ).toEqual([10, 11]);
  });

  it("9月に開いたときの実績は前期12か月の累計で、前々期12か月と比べる", () => {
    const months = [9, 10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8];
    const column = summarizePerformanceColumn(
      previousMonthInJst(new Date("2026-09-10T03:00:00Z")),
      lookupOf([
        ...months.map((m) => snapshot(2025, m, { revenue: 10, ordinaryProfit: 1 }, "2026-09-05T00:00:00Z")),
        ...months.map((m) => snapshot(2024, m, { revenue: 7, ordinaryProfit: -1 }, "2025-09-05T00:00:00Z")),
      ]),
      { requireMonthEnd: true }
    );
    expect(column.months).toEqual(months);
    expect(column.amounts.revenue).toEqual({ current: 120, previous: 84, change: 36 });
    expect(column.amounts.ordinaryProfit).toEqual({ current: 12, previous: -12, change: 24 });
  });
});

describe("資金の比較", () => {
  const october = targetMonth(50, 10);
  const now = new Date("2026-11-13T03:00:00Z");
  const base: MonthEndCashSnapshot = {
    cashClosing: 1_000 + 300 + 7,
    checkingSavingsClosing: 1_000,
    timeDepositClosing: 300,
    cashOnHandClosing: 7,
    fetchedAt: new Date("2026-11-01T09:00:00Z"),
  };

  it("当座・普通は定期・小口現金を含まない。現預金残高は小口現金を含む。担保控除額が無ければ控除後は未設定", () => {
    expect(summarizePreviousMonthCash(october, base, NO_COLLATERAL, now)).toMatchObject({
      status: "fetched",
      checkingSavings: 1_000,
      depositTotalBeforeCollateral: 1_300,
      depositTotalAfterCollateral: null,
      cashClosing: 1_307,
      kindsDifference: 0,
    });
  });

  it("担保控除額があれば 当座・普通 + 定期 − 担保控除。明示の0円は控除前と同額で表示する(未設定と区別)", () => {
    const set = { amount: 200, asOf: "2026-10-01", source: "架空" };
    expect(summarizePreviousMonthCash(october, base, set, now)).toMatchObject({ depositTotalAfterCollateral: 1_100 });
    const zero = { amount: 0, asOf: "2026-10-01", source: "架空" };
    expect(summarizePreviousMonthCash(october, base, zero, now)).toMatchObject({ depositTotalAfterCollateral: 1_300 });
  });

  it("前月末: 月末前に取得したスナップショットは月末実績にしない。種類別の項目が無い保存分・保存なしも未取得", () => {
    const early = { ...base, fetchedAt: new Date("2026-10-31T09:00:00Z") };
    expect(summarizePreviousMonthCash(october, early, NO_COLLATERAL, now).status).toBe("notFetched");
    expect(summarizePreviousMonthCash(october, { ...base, timeDepositClosing: undefined }, NO_COLLATERAL, now).status).toBe(
      "notFetched"
    );
    expect(summarizePreviousMonthCash(october, null, NO_COLLATERAL, now).status).toBe("notFetched");
  });

});

describe("収支予定の対象月", () => {
  it("翌月は期をまたぐと次期の9月、年をまたぐと翌年1月", () => {
    expect(nextTargetMonth(targetMonth(50, 11))).toMatchObject({ term: 50, month: 12, key: "2026-12" });
    expect(nextTargetMonth(targetMonth(50, 12))).toMatchObject({ term: 50, month: 1, key: "2027-01" });
    expect(nextTargetMonth(targetMonth(50, 8))).toMatchObject({ term: 51, month: 9, key: "2027-09" });
  });

  it("登録済みの資金繰り予定がある月だけ対応させ、無い月はnull(他の月の予定や残高で埋めない)", () => {
    const plan = (targetMonth: string) => ({ targetMonth }) as unknown as import("./accountingReports").CashPlan;
    const result = selectCashPlanOutlook([plan("2026-10"), plan("2026-11")], [targetMonth(50, 11), targetMonth(50, 12)]);
    expect(result.map((r) => [r.target.key, r.plan?.targetMonth ?? null])).toEqual([
      ["2026-11", "2026-11"],
      ["2026-12", null],
    ]);
  });
});
