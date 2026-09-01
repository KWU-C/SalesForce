import { describe, expect, it } from "vitest";
import type { CategoryBreakdown } from "@/domain/types";
import { buildCategorySlices, OTHER_CATEGORY_LABEL } from "./categoryChart";

const COMPANY_WIDE: CategoryBreakdown[] = [
  { category: "未設定", grossProfit: 1000 },
  { category: "企業ブランディング", grossProfit: 900 },
  { category: "パッケージ", grossProfit: 300 },
  { category: "商品ブランディング", grossProfit: 200 },
  { category: "Web・デジタル", grossProfit: 100 },
  { category: "ネーミング", grossProfit: 50 },
  { category: "グラフィック", grossProfit: 10 },
];

describe("buildCategorySlices", () => {
  it("keeps only the company-wide top 5 real categories (excluding 未設定), folding the rest into その他・未設定", () => {
    const slices = buildCategorySlices(COMPANY_WIDE, COMPANY_WIDE);

    expect(slices.map((s) => s.category)).toEqual([
      "企業ブランディング",
      "パッケージ",
      "商品ブランディング",
      "Web・デジタル",
      "ネーミング",
      OTHER_CATEGORY_LABEL,
    ]);
    // 未設定(1000) + グラフィック(10) = その他・未設定 1010
    expect(slices.find((s) => s.category === OTHER_CATEGORY_LABEL)?.grossProfit).toBe(1010);
  });

  it("never treats 未設定 as a top category, even when it's the single largest bucket", () => {
    const slices = buildCategorySlices(COMPANY_WIDE, COMPANY_WIDE);

    expect(slices.some((s) => s.category === "未設定")).toBe(false);
    expect(slices[0].category).not.toBe("未設定");
  });

  it("assigns a fixed color slot per category name, even when a CR's own ranking differs from the company-wide ranking", () => {
    // このCRでは「パッケージ」が最大だが、全社の上位5(企業ブランディング/パッケージ/商品ブランディング/Web・デジタル/ネーミング)は変わらない
    const crBreakdown: CategoryBreakdown[] = [
      { category: "パッケージ", grossProfit: 500 },
      { category: "企業ブランディング", grossProfit: 10 },
    ];
    const slices = buildCategorySlices(COMPANY_WIDE, crBreakdown);

    const packaging = slices.find((s) => s.category === "パッケージ");
    const branding = slices.find((s) => s.category === "企業ブランディング");
    expect(packaging?.colorVar).toBe("--series-category-2"); // 全社基準で2番目の色のまま
    expect(branding?.colorVar).toBe("--series-category-1"); // 全社基準で1番目の色のまま
  });

  it("folds a category outside the company-wide top 5 into その他・未設定 even if it's large within this CR", () => {
    const crBreakdown: CategoryBreakdown[] = [{ category: "グラフィック", grossProfit: 9_000_000 }];
    const slices = buildCategorySlices(COMPANY_WIDE, crBreakdown);

    expect(slices).toEqual([
      { category: OTHER_CATEGORY_LABEL, grossProfit: 9_000_000, colorVar: "--series-other" },
    ]);
  });

  it("folds this CR's own 未設定 records into その他・未設定 too", () => {
    const crBreakdown: CategoryBreakdown[] = [{ category: "未設定", grossProfit: 5_000_000 }];
    const slices = buildCategorySlices(COMPANY_WIDE, crBreakdown);

    expect(slices).toEqual([
      { category: OTHER_CATEGORY_LABEL, grossProfit: 5_000_000, colorVar: "--series-other" },
    ]);
  });

  it("omits zero-value top categories and returns an empty list when there is no data at all", () => {
    expect(buildCategorySlices(COMPANY_WIDE, [])).toEqual([]);
  });
});
