import { describe, expect, it } from "vitest";
import type { MonthlyProgress } from "@/domain/types";
import { summarizePeriod } from "./aggregate";

function row(month: number, overrides: Partial<MonthlyProgress> = {}): MonthlyProgress {
  return {
    crId: "CR1",
    kind: "order",
    month,
    sales: 100,
    grossProfit: 30,
    targetGrossProfit: 40,
    achievementRate: 75,
    ...overrides,
  };
}

describe("summarizePeriod", () => {
  it("sums sales/grossProfit and recomputes achievementRate over the given months", () => {
    const data = [row(9), row(10, { sales: 110, grossProfit: 33 }), row(11, { sales: 120, grossProfit: 36 })];
    const summary = summarizePeriod("第1四半期", [9, 10, 11], data);

    expect(summary.sales).toBe(330);
    expect(summary.grossProfit).toBe(99);
    expect(summary.targetGrossProfit).toBe(120);
    expect(summary.achievementRate).toBe(82.5);
  });

  it("excludes null (未入力) months from the sum instead of treating them as 0", () => {
    const data = [
      row(9, { sales: 100, grossProfit: 30 }),
      row(10, { sales: null, grossProfit: null, achievementRate: null }),
      row(11, { sales: 120, grossProfit: 36 }),
    ];
    const summary = summarizePeriod("第1四半期", [9, 10, 11], data);

    // 10月が未入力でも、9月・11月の実績だけで合算される(0扱いにしない)
    expect(summary.sales).toBe(220);
    expect(summary.grossProfit).toBe(66);
    // 目標は月が未入力でも常に積み上げる
    expect(summary.targetGrossProfit).toBe(120);
  });

  it("returns null (not 0) when every month in range is unentered", () => {
    const data = [
      row(9, { sales: null, grossProfit: null, achievementRate: null }),
      row(10, { sales: null, grossProfit: null, achievementRate: null }),
    ];
    const summary = summarizePeriod("第1四半期", [9, 10], data);

    expect(summary.sales).toBeNull();
    expect(summary.grossProfit).toBeNull();
    expect(summary.achievementRate).toBeNull();
    expect(summary.targetGrossProfit).toBe(80);
  });
});
