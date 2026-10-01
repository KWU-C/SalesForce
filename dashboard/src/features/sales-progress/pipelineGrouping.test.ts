import { describe, expect, it } from "vitest";
import type { PipelineDeal } from "@/domain/types";
import { groupPipelineDealsByConfidence, sumConfidenceForecastByMonth } from "./pipelineGrouping";

function deal(overrides: Partial<PipelineDeal>): PipelineDeal {
  return {
    processId: "id",
    confidence: "A (80～100%)",
    clientName: "クライアント",
    dealName: "案件",
    grossProfit: 100,
    sales: 300,
    salesforceMemo: null,
    expectedOrderDate: null,
    salesforceMemoUpdatedAt: "2026-08-15T02:30:00.000+0000",
    ...overrides,
  };
}

describe("groupPipelineDealsByConfidence", () => {
  it("groups by confidence and orders groups A, B, C, D", () => {
    const deals = [
      deal({ processId: "d", confidence: "D (引き合い)" }),
      deal({ processId: "b", confidence: "B (50～80%未満)" }),
      deal({ processId: "a", confidence: "A (80～100%)" }),
      deal({ processId: "c", confidence: "C (新規問い合わせ)" }),
    ];

    const groups = groupPipelineDealsByConfidence(deals);
    expect(groups.map((g) => g.confidence)).toEqual([
      "A (80～100%)",
      "B (50～80%未満)",
      "C (新規問い合わせ)",
      "D (引き合い)",
    ]);
  });

  it("adds a grossProfitSubtotal for A and B groups only", () => {
    const deals = [
      deal({ processId: "a1", confidence: "A (80～100%)", grossProfit: 100 }),
      deal({ processId: "a2", confidence: "A (80～100%)", grossProfit: 200 }),
      deal({ processId: "b1", confidence: "B (50～80%未満)", grossProfit: 50 }),
      deal({ processId: "c1", confidence: "C (新規問い合わせ)", grossProfit: 999 }),
      deal({ processId: "d1", confidence: "D (引き合い)", grossProfit: 999 }),
    ];

    const groups = groupPipelineDealsByConfidence(deals);
    const byConfidence = Object.fromEntries(groups.map((g) => [g.confidence, g.grossProfitSubtotal]));

    expect(byConfidence["A (80～100%)"]).toBe(300);
    expect(byConfidence["B (50～80%未満)"]).toBe(50);
    expect(byConfidence["C (新規問い合わせ)"]).toBeNull();
    expect(byConfidence["D (引き合い)"]).toBeNull();
  });

  it("treats a null grossProfit as 0 within the subtotal", () => {
    const deals = [
      deal({ processId: "a1", confidence: "A (80～100%)", grossProfit: 100 }),
      deal({ processId: "a2", confidence: "A (80～100%)", grossProfit: null }),
    ];

    const groups = groupPipelineDealsByConfidence(deals);
    expect(groups[0].grossProfitSubtotal).toBe(100);
  });

  it("adds a salesSubtotal for A and B groups only, treating null sales as 0", () => {
    const deals = [
      deal({ processId: "a1", confidence: "A (80～100%)", sales: 500 }),
      deal({ processId: "a2", confidence: "A (80～100%)", sales: null }),
      deal({ processId: "b1", confidence: "B (50～80%未満)", sales: 700 }),
      deal({ processId: "c1", confidence: "C (新規問い合わせ)", sales: 999 }),
    ];

    const groups = groupPipelineDealsByConfidence(deals);
    const byConfidence = Object.fromEntries(groups.map((g) => [g.confidence, g.salesSubtotal]));

    expect(byConfidence["A (80～100%)"]).toBe(500);
    expect(byConfidence["B (50～80%未満)"]).toBe(700);
    expect(byConfidence["C (新規問い合わせ)"]).toBeNull();
  });

  it("returns an empty array for no deals", () => {
    expect(groupPipelineDealsByConfidence([])).toEqual([]);
  });
});

describe("sumConfidenceForecastByMonth", () => {
  const term50 = { start: "2026-09-01", end: "2027-08-31" };

  it("sums confidence-A deals by the calendar month of the expected order date", () => {
    const deals = [
      deal({ expectedOrderDate: "2026-10-05", grossProfit: 100, sales: 300 }),
      deal({ expectedOrderDate: "2026-10-31", grossProfit: 50, sales: null }),
      deal({ expectedOrderDate: "2026-11-01", grossProfit: 7, sales: 9 }),
    ];

    const byMonth = sumConfidenceForecastByMonth(deals, term50, "A ");
    expect(byMonth.get(10)).toEqual({ grossProfit: 150, sales: 300 });
    expect(byMonth.get(11)).toEqual({ grossProfit: 7, sales: 9 });
    expect(byMonth.has(12)).toBe(false);
  });

  it("ignores other confidences, deals without an expected order date, and dates outside the term", () => {
    const deals = [
      deal({ confidence: "B (50～80%未満)", expectedOrderDate: "2026-10-05" }),
      deal({ expectedOrderDate: null }),
      deal({ expectedOrderDate: "2025-10-05" }),
      deal({ expectedOrderDate: "2027-10-05" }),
    ];

    expect(sumConfidenceForecastByMonth(deals, term50, "A ").size).toBe(0);
  });

  it("sums only the requested confidence", () => {
    const deals = [
      deal({ confidence: "B (50～80%未満)", expectedOrderDate: "2026-10-05", grossProfit: 40, sales: 60 }),
      deal({ expectedOrderDate: "2026-10-05" }),
    ];

    expect(sumConfidenceForecastByMonth(deals, term50, "B ").get(10)).toEqual({ grossProfit: 40, sales: 60 });
  });
});
