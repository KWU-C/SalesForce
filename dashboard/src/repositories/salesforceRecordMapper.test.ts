import { describe, expect, it } from "vitest";
import { mapAggregateRowsToMonthlyProgress } from "./salesforceRecordMapper";
import type { AnnualSalesTarget, ProgressAggregateRow } from "./salesforceRecordMapper";

const perCrTarget: AnnualSalesTarget = {
  targetSales: 213_333_333.33,
  targetGrossProfit: 180_000_000,
};

describe("mapAggregateRowsToMonthlyProgress", () => {
  it("fills sales/grossProfit for months present in the aggregate rows", () => {
    const rows: ProgressAggregateRow[] = [
      { crId: "CR1", mo: 9, sales: 20_000_000, grossProfit: 6_000_000 },
      { crId: "CR2", mo: 9, sales: 999_999, grossProfit: 999_999 }, // 別CR、混ざらないことを確認
    ];

    const result = mapAggregateRowsToMonthlyProgress(rows, "CR1", "order", perCrTarget);
    const sep = result.find((r) => r.month === 9);

    expect(sep?.sales).toBe(20_000_000);
    expect(sep?.grossProfit).toBe(6_000_000);
    expect(sep?.crId).toBe("CR1");
    expect(sep?.kind).toBe("order");
  });

  it("treats months absent from the aggregate rows as null (not 0)", () => {
    const result = mapAggregateRowsToMonthlyProgress([], "CR1", "order", perCrTarget);

    expect(result).toHaveLength(12);
    for (const row of result) {
      expect(row.sales).toBeNull();
      expect(row.grossProfit).toBeNull();
      expect(row.achievementRate).toBeNull();
    }
  });

  it("splits the annual target evenly across the 12 months", () => {
    const result = mapAggregateRowsToMonthlyProgress([], "CR1", "order", perCrTarget);

    for (const row of result) {
      expect(row.targetGrossProfit).toBeCloseTo(15_000_000, 5);
      expect(row.targetSales).toBeCloseTo(17_777_777.78, 1);
    }
  });

  it("computes achievementRate as grossProfit / monthly targetGrossProfit * 100", () => {
    const rows: ProgressAggregateRow[] = [
      { crId: "CR1", mo: 9, sales: 20_000_000, grossProfit: 16_500_000 },
    ];

    const result = mapAggregateRowsToMonthlyProgress(rows, "CR1", "order", perCrTarget);
    const sep = result.find((r) => r.month === 9);

    // 16,500,000 / 15,000,000 * 100 = 110.0
    expect(sep?.achievementRate).toBe(110);
  });
});
