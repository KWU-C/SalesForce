import { describe, expect, it } from "vitest";
import { aggregateCategoryBreakdown, type CategoryAggregateRow } from "./categoryBreakdown";

const ROWS: CategoryAggregateRow[] = [
  { crId: "CR1", category: "企業ブランディング", grossProfit: 100 },
  { crId: "CR1", category: "パッケージ", grossProfit: 300 },
  { crId: "CR2", category: "企業ブランディング", grossProfit: 50 },
  { crId: "CR2", category: null, grossProfit: 20 },
];

describe("aggregateCategoryBreakdown", () => {
  it("filters by crId and sorts by grossProfit descending", () => {
    const result = aggregateCategoryBreakdown(ROWS, "CR1");
    expect(result).toEqual([
      { category: "パッケージ", grossProfit: 300 },
      { category: "企業ブランディング", grossProfit: 100 },
    ]);
  });

  it('maps a null category to "未設定"', () => {
    const result = aggregateCategoryBreakdown(ROWS, "CR2");
    expect(result).toEqual([
      { category: "企業ブランディング", grossProfit: 50 },
      { category: "未設定", grossProfit: 20 },
    ]);
  });

  it("ALL merges the same category across CRs", () => {
    const result = aggregateCategoryBreakdown(ROWS, "ALL");
    expect(result).toEqual([
      { category: "パッケージ", grossProfit: 300 },
      { category: "企業ブランディング", grossProfit: 150 },
      { category: "未設定", grossProfit: 20 },
    ]);
  });
});
