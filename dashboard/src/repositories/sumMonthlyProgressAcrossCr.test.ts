import { describe, expect, it } from "vitest";
import type { MonthlyProgress } from "@/domain/types";
import { sumMonthlyProgressAcrossCr } from "./sumMonthlyProgressAcrossCr";

function row(crId: "CR1" | "CR2", month: number, overrides: Partial<MonthlyProgress> = {}): MonthlyProgress {
  return {
    crId,
    kind: "order",
    month,
    sales: 100,
    grossProfit: 30,
    targetGrossProfit: 40,
    achievementRate: 75,
    ...overrides,
  };
}

describe("sumMonthlyProgressAcrossCr", () => {
  it("sums matching months across CRs by month value, not array position", () => {
    const cr1 = [row("CR1", 10, { sales: 100, grossProfit: 30 }), row("CR1", 9, { sales: 90, grossProfit: 27 })];
    const cr2 = [row("CR2", 9, { sales: 50, grossProfit: 15 }), row("CR2", 10, { sales: 60, grossProfit: 18 })];

    const result = sumMonthlyProgressAcrossCr([cr1, cr2], "order");
    const sep = result.find((r) => r.month === 9);
    const oct = result.find((r) => r.month === 10);

    expect(sep?.sales).toBe(140);
    expect(oct?.sales).toBe(160);
  });

  it("sums only the CRs that have entered data for a month, leaving it null if none have", () => {
    const cr1 = [row("CR1", 9, { sales: 100, grossProfit: 30 })];
    const cr2 = [row("CR2", 9, { sales: null, grossProfit: null, achievementRate: null })];

    const result = sumMonthlyProgressAcrossCr([cr1, cr2], "order");
    const sep = result.find((r) => r.month === 9);

    // CR2が未入力でもCR1の実績はそのまま反映される(0扱いで潰さない)
    expect(sep?.sales).toBe(100);
    expect(sep?.grossProfit).toBe(30);
  });

  it("returns null for a month when no CR has entered data", () => {
    const cr1 = [row("CR1", 9, { sales: null, grossProfit: null, achievementRate: null })];
    const cr2 = [row("CR2", 9, { sales: null, grossProfit: null, achievementRate: null })];

    const result = sumMonthlyProgressAcrossCr([cr1, cr2], "order");
    const sep = result.find((r) => r.month === 9);

    expect(sep?.sales).toBeNull();
    expect(sep?.grossProfit).toBeNull();
    expect(sep?.achievementRate).toBeNull();
  });
});
