import { describe, expect, it } from "vitest";
import type { CategoryBreakdown } from "@/domain/types";
import { buildCategorySlices, OTHER_CATEGORY_LABEL } from "./categoryChart";

const COMPANY_WIDE: CategoryBreakdown[] = [
  { category: "未設定", grossProfit: 1000 },
  { category: "企業ブランディング", grossProfit: 900 },
  { category: "パッケージ", grossProfit: 300 },
  { category: "商品ブランディング", grossProfit: 200 },
  { category: "Web・デジタル", grossProfit: 100 },
];

describe("buildCategorySlices", () => {
  it("keeps only the company-wide top 3 categories, folding the rest into その他", () => {
    const slices = buildCategorySlices(COMPANY_WIDE, COMPANY_WIDE);

    expect(slices.map((s) => s.category)).toEqual([
      "未設定",
      "企業ブランディング",
      "パッケージ",
      OTHER_CATEGORY_LABEL,
    ]);
    // 商品ブランディング(200) + Web・デジタル(100) = その他300
    expect(slices.find((s) => s.category === OTHER_CATEGORY_LABEL)?.grossProfit).toBe(300);
  });

  it("assigns a fixed color slot per category name, even when a CR's own ranking differs from the company-wide ranking", () => {
    // このCRでは「パッケージ」が最大だが、全社の上位3(未設定/企業ブランディング/パッケージ)は変わらない
    const crBreakdown: CategoryBreakdown[] = [
      { category: "パッケージ", grossProfit: 500 },
      { category: "企業ブランディング", grossProfit: 10 },
    ];
    const slices = buildCategorySlices(COMPANY_WIDE, crBreakdown);

    const packaging = slices.find((s) => s.category === "パッケージ");
    const branding = slices.find((s) => s.category === "企業ブランディング");
    expect(packaging?.colorVar).toBe("--series-category-3"); // 全社基準で3番目の色のまま
    expect(branding?.colorVar).toBe("--series-category-2"); // 全社基準で2番目の色のまま
  });

  it("folds a category outside the company-wide top 3 into その他 even if it's large within this CR", () => {
    const crBreakdown: CategoryBreakdown[] = [{ category: "Web・デジタル", grossProfit: 9_000_000 }];
    const slices = buildCategorySlices(COMPANY_WIDE, crBreakdown);

    expect(slices).toEqual([
      { category: OTHER_CATEGORY_LABEL, grossProfit: 9_000_000, colorVar: "--series-other" },
    ]);
  });

  it("omits zero-value top categories and returns an empty list when there is no data at all", () => {
    expect(buildCategorySlices(COMPANY_WIDE, [])).toEqual([]);
  });
});
