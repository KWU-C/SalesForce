import { describe, expect, it } from "vitest";
import type { CrId, CrProgress, MonthlyProgress, ProgressKind } from "@/domain/types";
import { FISCAL_MONTH_ORDER } from "@/config/fiscalPeriods";
import { buildCrossCrProgress, getCrossCrList } from "./crossCrProgress";

const TERM_49 = 49; // CR1〜3構成（48・49期）
const TERM_50 = 50; // CR1〜4構成（50期以降、ユーザー確定2026-09-01）

type ConcreteCrId = Exclude<CrId, "ALL">;

function buildSeries(
  crId: ConcreteCrId,
  kind: ProgressKind,
  target: number,
  valuesByMonth: Partial<Record<number, number | null>>,
  upToFiscalIndex: number
): MonthlyProgress[] {
  return FISCAL_MONTH_ORDER.map((month, i) => {
    const fiscalIndex = i + 1;
    const isFuture = fiscalIndex > upToFiscalIndex;
    const grossProfit = isFuture ? null : (valuesByMonth[month] ?? null);
    return {
      crId,
      kind,
      month,
      sales: grossProfit === null ? null : grossProfit * 3,
      grossProfit,
      targetGrossProfit: target,
      achievementRate:
        grossProfit === null ? null : Math.round((grossProfit / target) * 1000) / 10,
    };
  });
}

function buildCrProgress(
  crId: ConcreteCrId,
  target: number,
  order: Partial<Record<number, number | null>>,
  completed: Partial<Record<number, number | null>>,
  upToFiscalIndex = 12
): CrProgress {
  return {
    crId,
    order: buildSeries(crId, "order", target, order, upToFiscalIndex),
    completed: buildSeries(crId, "completed", target, completed, upToFiscalIndex),
    previousOrder: [],
    previousCompleted: [],
    topOrderClients: [],
    topCompletedClients: [],
    topOrderLeaders: [],
    topCompletedLeaders: [],
    orderByCategory: [],
  };
}

// CR1: target 15,000/月。9月=15,000(ちょうど100%)、10月=16,500(110%)、11月=13,500。
// 12月〜8月は全て目標通り15,000にして残りは常に100%になるようにしておく。
const CR1_ORDER = { 9: 15_000, 10: 16_500, 11: 13_500, 12: 15_000, 1: 15_000, 2: 15_000, 3: 15_000, 4: 15_000, 5: 15_000, 6: 15_000, 7: 15_000, 8: 15_000 };
// 完了は8月だけ大きく上振れさせ、累積達成率が100%ちょうどにならないようにする
const CR1_COMPLETED = { 9: 14_000, 10: 14_000, 11: 14_000, 12: 14_000, 1: 14_000, 2: 14_000, 3: 14_000, 4: 14_000, 5: 14_000, 6: 14_000, 7: 14_000, 8: 20_000 };

const CR2_ORDER = { 9: 21_000, 10: 19_000, 11: 20_000, 12: 20_000, 1: 20_000, 2: 20_000, 3: 20_000, 4: 20_000, 5: 20_000, 6: 20_000, 7: 20_000, 8: 20_000 };
const CR2_COMPLETED = { 9: 18_000, 10: 22_000, 11: 20_000, 12: 20_000, 1: 20_000, 2: 20_000, 3: 20_000, 4: 20_000, 5: 20_000, 6: 20_000, 7: 20_000, 8: 24_000 };

const CR3_ORDER = { 9: 9_000, 10: 11_000, 11: 10_000, 12: 10_000, 1: 10_000, 2: 10_000, 3: 10_000, 4: 10_000, 5: 10_000, 6: 10_000, 7: 10_000, 8: 10_000 };
const CR3_COMPLETED = { 9: 10_000, 10: 10_000, 11: 10_000, 12: 10_000, 1: 10_000, 2: 10_000, 3: 10_000, 4: 10_000, 5: 10_000, 6: 10_000, 7: 10_000, 8: 8_000 };

function fullYearFixture(): CrProgress[] {
  return [
    buildCrProgress("CR1", 15_000, CR1_ORDER, CR1_COMPLETED),
    buildCrProgress("CR2", 20_000, CR2_ORDER, CR2_COMPLETED),
    buildCrProgress("CR3", 10_000, CR3_ORDER, CR3_COMPLETED),
  ];
}

function sumRange(values: Partial<Record<number, number | null>>, months: number[]): number {
  return months.reduce((sum, m) => sum + (values[m] ?? 0), 0);
}

function expectedRate(gpSum: number, targetSum: number): number {
  return Math.round((gpSum / targetSum) * 1000) / 10;
}

describe("getCrossCrList", () => {
  it("lists CR1/CR2/CR3 only for 48・49期 (excludes ALL)", () => {
    expect(getCrossCrList(TERM_49).map((cr) => cr.id)).toEqual(["CR1", "CR2", "CR3"]);
  });

  it("includes CR4 for 50期以降 (ユーザー確定2026-09-01)", () => {
    expect(getCrossCrList(TERM_50).map((cr) => cr.id)).toEqual(["CR1", "CR2", "CR3", "CR4"]);
  });
});

describe("buildCrossCrProgress — 50期はCR4列が加わる", () => {
  it("includes a CR4 column when progressByCr has a CR4 entry and term=50", () => {
    const progressByCr = [
      ...fullYearFixture(),
      buildCrProgress("CR4", 12_000, { 9: 12_000 }, { 9: 12_000 }),
    ];
    const { monthRows, totalRow } = buildCrossCrProgress(progressByCr, 9, TERM_50);

    expect(monthRows[0].columns.map((c) => c.crId)).toEqual(["CR1", "CR2", "CR3", "CR4"]);
    expect(totalRow.map((c) => c.crId)).toEqual(["CR1", "CR2", "CR3", "CR4"]);
    expect(monthRows[0].columns.find((c) => c.crId === "CR4")?.orderGrossProfit).toBe(12_000);
  });
});

describe("buildCrossCrProgress — 通年(currentMonth=8月)", () => {
  const progressByCr = fullYearFixture();
  const { monthRows, totalRow } = buildCrossCrProgress(progressByCr, 8, TERM_49);

  function col(month: number, crId: string) {
    const row = monthRows.find((r) => r.month === month)!;
    return row.columns.find((c) => c.crId === crId)!;
  }

  it("CR1の9月受注粗利は既存グラフ・月次表と同じ配列の値と一致する(同一参照)", () => {
    const cr1 = progressByCr.find((p) => p.crId === "CR1")!;
    const sepRow = cr1.order.find((r) => r.month === 9)!;
    expect(col(9, "CR1").orderGrossProfit).toBe(sepRow.grossProfit);
    expect(col(9, "CR1").orderGrossProfit).toBe(15_000);
    expect(col(9, "CR1").orderMonthlyRate).toBeCloseTo(100, 5);
  });

  it("CR1の10月受注累積達成率が正しい(9〜10月の累積 ÷ 年間フル目標12ヶ月分)", () => {
    const gpSum = sumRange(CR1_ORDER, [9, 10]);
    const targetSum = 15_000 * 12;
    expect(col(10, "CR1").orderCumulativeRate).toBeCloseTo(expectedRate(gpSum, targetSum), 5);
    // 手計算でも17.5%
    expect(col(10, "CR1").orderCumulativeRate).toBeCloseTo(17.5, 5);
  });

  it("CR1の8月完了累積達成率が正しい(9〜8月・通期の累積)", () => {
    const gpSum = sumRange(CR1_COMPLETED, FISCAL_MONTH_ORDER);
    const targetSum = 15_000 * 12;
    expect(col(8, "CR1").completedCumulativeRate).toBeCloseTo(expectedRate(gpSum, targetSum), 5);
  });

  it("CR2も同じ計算式になる(9〜11月の受注累積 ÷ 年間フル目標12ヶ月分)", () => {
    const gpSum = sumRange(CR2_ORDER, [9, 10, 11]);
    const targetSum = 20_000 * 12;
    expect(col(11, "CR2").orderCumulativeRate).toBeCloseTo(expectedRate(gpSum, targetSum), 5);
  });

  it("CR3も同じ計算式になる(9〜8月の完了累積達成率)", () => {
    const gpSum = sumRange(CR3_COMPLETED, FISCAL_MONTH_ORDER);
    const targetSum = 10_000 * 12;
    expect(col(8, "CR3").completedCumulativeRate).toBeCloseTo(expectedRate(gpSum, targetSum), 5);
  });

  it("合計行は通期(9〜8月)の受注/完了粗利合計と、年間フル目標に対する達成率になる(通年なので8月行の累積と一致)", () => {
    const total = totalRow.find((c) => c.crId === "CR1")!;
    const aug = col(8, "CR1");
    expect(total.orderGrossProfit).toBe(aug.orderGrossProfit === null ? null : sumRange(CR1_ORDER, FISCAL_MONTH_ORDER));
    expect(total.targetGrossProfit).toBe(15_000 * 12);
    // 通年(8月)なので8月行の累積(9〜8月=12ヶ月分)と分母が一致し、達成率も一致する
    expect(total.orderCumulativeRate).toBeCloseTo(aug.orderCumulativeRate!, 5);
    expect(total.completedCumulativeRate).toBeCloseTo(aug.completedCumulativeRate!, 5);
    // 合計行に月次達成率は存在しない
    expect(total.orderMonthlyRate).toBeNull();
    expect(total.completedMonthlyRate).toBeNull();
  });

  it("現在月(8月)フラグが立つのは1行だけ", () => {
    const flagged = monthRows.filter((r) => r.isCurrentMonth);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].month).toBe(8);
  });
});

describe("buildCrossCrProgress — 期中(currentMonth=11月、12月以降は未到来)", () => {
  // buildCrossCrProgressはgetCrossCrList(49期はCR1〜3)全件を走査するため、テスト対象がCR1でも
  // CR2/CR3のデータも用意しておく必要がある
  const progressByCr = [
    buildCrProgress("CR1", 15_000, CR1_ORDER, CR1_COMPLETED, 3), // fiscalIndex 3 = 11月まで
    buildCrProgress("CR2", 20_000, CR2_ORDER, CR2_COMPLETED, 3),
    buildCrProgress("CR3", 10_000, CR3_ORDER, CR3_COMPLETED, 3),
  ];
  const { monthRows, totalRow } = buildCrossCrProgress(progressByCr, 11, TERM_49);

  function col(month: number) {
    return monthRows.find((r) => r.month === month)!.columns[0];
  }

  it("未到来月(12月〜8月)は受注/完了ともnull(未入力)であり、0として合算されない", () => {
    expect(col(12).orderGrossProfit).toBeNull();
    expect(col(8).completedGrossProfit).toBeNull();
  });

  it("8月行(未到来)の累積は、実績が入っている9〜11月分だけを合算する(0扱いしない)", () => {
    const gpSum = sumRange(CR1_ORDER, [9, 10, 11]); // 12月以降は元データがnullなので寄与しない
    // 累積%の分母は常に年間フル目標(12ヶ月分)
    const targetSum = 15_000 * 12;
    expect(col(8).orderCumulativeRate).toBeCloseTo(expectedRate(gpSum, targetSum), 5);
  });

  it("合計行の実績は「現在月(11月)まで」のデータしか無い場合、9〜11月の合計になる。目標(表示欄)は月行の1ヶ月分と違い年間フル目標(12ヶ月分)を使う", () => {
    const total = totalRow[0];
    const nov = col(11);

    const gpSumThroughNov = sumRange(CR1_ORDER, [9, 10, 11]);
    expect(total.orderGrossProfit).toBe(gpSumThroughNov);
    // 「目標」表示欄は経過月(9〜11月=3ヶ月分)ではなく年間フル(12ヶ月分)
    expect(total.targetGrossProfit).toBe(15_000 * 12);
    expect(total.targetGrossProfit).not.toBe(nov.targetGrossProfit);

    // 累計%は月行・合計行とも常に年間フル目標が分母のため、11月行と合計行は一致する
    expect(total.orderCumulativeRate).toBeCloseTo(nov.orderCumulativeRate!, 5);
    expect(total.orderCumulativeRate).toBeCloseTo(expectedRate(gpSumThroughNov, 15_000 * 12), 5);
  });
});

describe("buildCrossCrProgress — 合計行は現在月より先の実績も合算する(2026-09-18修正: 期首直後などcurrentMonthに縛られない)", () => {
  it("現在月(9月)より先(1月)まで既に実績が入っている場合、合計行の受注/完了は現在月止まりにせず全実績を合算する", () => {
    // upToFiscalIndex=5 → 9,10,11,12,1月まで実データあり(先付けの受注・完了)。currentMonth=9のみ経過
    const progressByCr = [
      buildCrProgress("CR1", 15_000, CR1_ORDER, CR1_COMPLETED, 5),
      buildCrProgress("CR2", 20_000, CR2_ORDER, CR2_COMPLETED, 5),
      buildCrProgress("CR3", 10_000, CR3_ORDER, CR3_COMPLETED, 5),
    ];
    const { totalRow } = buildCrossCrProgress(progressByCr, 9, TERM_49);
    const total = totalRow.find((c) => c.crId === "CR1")!;

    const gpSumThroughJan = sumRange(CR1_ORDER, [9, 10, 11, 12, 1]);
    // 修正前は9月単月(15,000)だけが反映され、10月〜1月の先付け実績が抜け落ちていた
    expect(total.orderGrossProfit).toBe(gpSumThroughJan);
    expect(total.orderGrossProfit).not.toBe(sumRange(CR1_ORDER, [9]));
  });
});

describe("null(未入力)と0(実績0円)の区別", () => {
  it("未入力月はnull、実績0円の月は0のまま(区別される)", () => {
    const progressByCr = [
      buildCrProgress("CR1", 15_000, { 9: 0, 10: null }, { 9: 0, 10: null }, 12),
      buildCrProgress("CR2", 20_000, {}, {}, 12),
      buildCrProgress("CR3", 10_000, {}, {}, 12),
    ];
    const { monthRows } = buildCrossCrProgress(progressByCr, 8, TERM_49);
    const sep = monthRows.find((r) => r.month === 9)!.columns[0];
    const oct = monthRows.find((r) => r.month === 10)!.columns[0];

    expect(sep.orderGrossProfit).toBe(0);
    expect(sep.orderMonthlyRate).toBe(0);
    expect(oct.orderGrossProfit).toBeNull();
    expect(oct.orderMonthlyRate).toBeNull();
  });
});
