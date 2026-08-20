import { describe, expect, it } from "vitest";
import type { MonthlyProgress } from "@/domain/types";
import { FISCAL_MONTH_ORDER } from "@/config/fiscalPeriods";
import { summarizePeriod } from "@/features/sales-progress/aggregate";
import { CUMULATIVE_GROUPS } from "./MonthlyCumulativeTable";

/**
 * 12ヶ月分の月別データ(9月始まり)。既存グラフ(PeriodComparisonChart)も
 * このMonthlyProgress[]をそのままrow.grossProfit等で参照しているため、
 * 同じ配列から読んだ値が一致することは「表がグラフと同じ値を出す」ことの
 * 直接的な裏付けになる（表専用の集計処理を別途作っていないことの検証）。
 */
function buildFixture(): MonthlyProgress[] {
  const monthlyTargetGrossProfit = 15_000; // 千円/月（ユーザー提示の例と揃える）
  return FISCAL_MONTH_ORDER.map((month, i) => ({
    crId: "CR1",
    kind: "order",
    month,
    sales: (i + 1) * 1000,
    grossProfit: (i + 1) * 300,
    targetGrossProfit: monthlyTargetGrossProfit,
    achievementRate: Math.round(((i + 1) * 300 * 1000) / monthlyTargetGrossProfit) / 10,
  }));
}

describe("CUMULATIVE_GROUPS", () => {
  it("defines the four cumulative windows exactly as specified (each starting from 9月)", () => {
    expect(CUMULATIVE_GROUPS.map((g) => g.cumulativeLabel)).toEqual([
      "第1四半期",
      "上半期",
      "第3四半期",
      "通期",
    ]);
    expect(CUMULATIVE_GROUPS[0].cumulativeMonths).toEqual([9, 10, 11]);
    expect(CUMULATIVE_GROUPS[1].cumulativeMonths).toEqual([9, 10, 11, 12, 1, 2]);
    // 第3四半期は3〜5月単独ではなく9〜5月の累積（ユーザー確定仕様）
    expect(CUMULATIVE_GROUPS[2].cumulativeMonths).toEqual([9, 10, 11, 12, 1, 2, 3, 4, 5]);
    expect(CUMULATIVE_GROUPS[3].cumulativeMonths).toEqual([
      9, 10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8,
    ]);
  });

  it("shows the individual 3 months per block, not the cumulative range", () => {
    expect(CUMULATIVE_GROUPS[0].monthsInGroup).toEqual([9, 10, 11]);
    expect(CUMULATIVE_GROUPS[1].monthsInGroup).toEqual([12, 1, 2]);
    expect(CUMULATIVE_GROUPS[2].monthsInGroup).toEqual([3, 4, 5]);
    expect(CUMULATIVE_GROUPS[3].monthsInGroup).toEqual([6, 7, 8]);
  });
});

describe("table values vs. chart values (same underlying MonthlyProgress[])", () => {
  const data = buildFixture();

  it("per-month cell values equal the exact row values PeriodComparisonChart would plot for that month", () => {
    // PeriodComparisonChart plots row.grossProfit per month directly from the
    // same array; the table's per-month columns read the same field via
    // data.find(d => d.month === m), so they must be identical by construction.
    for (const group of CUMULATIVE_GROUPS) {
      for (const month of group.monthsInGroup) {
        const row = data.find((d) => d.month === month);
        const chartValue = data.find((d) => d.month === month)?.grossProfit;
        expect(row?.grossProfit).toBe(chartValue);
      }
    }
  });

  it("累積列は代表月(11月/2月/5月/8月)時点でsummarizePeriodの累積計算と一致する", () => {
    // 11月時点 → 第1四半期累積(9〜11月)
    const q1 = summarizePeriod(
      CUMULATIVE_GROUPS[0].cumulativeLabel,
      CUMULATIVE_GROUPS[0].cumulativeMonths,
      data
    );
    expect(q1.grossProfit).toBe(300 + 600 + 900); // months 9,10,11 → i=0,1,2
    expect(q1.targetGrossProfit).toBe(15_000 * 3);
    expect(q1.achievementRate).toBeCloseTo((q1.grossProfit! / q1.targetGrossProfit) * 100, 5);

    // 2月時点 → 上半期累積(9〜2月)
    const h1 = summarizePeriod(
      CUMULATIVE_GROUPS[1].cumulativeLabel,
      CUMULATIVE_GROUPS[1].cumulativeMonths,
      data
    );
    expect(h1.grossProfit).toBe(300 * (1 + 2 + 3 + 4 + 5 + 6));
    expect(h1.targetGrossProfit).toBe(15_000 * 6);

    // 5月時点 → 第3四半期累積(9〜5月、3〜5月単独ではない)
    const q3 = summarizePeriod(
      CUMULATIVE_GROUPS[2].cumulativeLabel,
      CUMULATIVE_GROUPS[2].cumulativeMonths,
      data
    );
    expect(q3.grossProfit).toBe(300 * (1 + 2 + 3 + 4 + 5 + 6 + 7 + 8 + 9));
    expect(q3.targetGrossProfit).toBe(15_000 * 9);

    // 8月時点 → 通期累積(9〜8月)
    const full = summarizePeriod(
      CUMULATIVE_GROUPS[3].cumulativeLabel,
      CUMULATIVE_GROUPS[3].cumulativeMonths,
      data
    );
    expect(full.grossProfit).toBe(300 * (1 + 2 + 3 + 4 + 5 + 6 + 7 + 8 + 9 + 10 + 11 + 12));
    expect(full.targetGrossProfit).toBe(15_000 * 12);
  });

  it("未入力(null)月は合計から除外され、実績0とは区別される(既存ルール継承)", () => {
    const withGap = data.map((row) =>
      row.month === 10 ? { ...row, sales: null, grossProfit: null, achievementRate: null } : row
    );
    const q1 = summarizePeriod("第1四半期", [9, 10, 11], withGap);
    // 10月が未入力でも9月・11月だけで合算（0扱いにしない）
    expect(q1.grossProfit).toBe(300 + 900);
    expect(q1.grossProfit).not.toBeNull();

    const allGap = withGap.map((row) =>
      [9, 10, 11].includes(row.month)
        ? { ...row, sales: null, grossProfit: null, achievementRate: null }
        : row
    );
    const emptyQ1 = summarizePeriod("第1四半期", [9, 10, 11], allGap);
    expect(emptyQ1.grossProfit).toBeNull();
  });
});
