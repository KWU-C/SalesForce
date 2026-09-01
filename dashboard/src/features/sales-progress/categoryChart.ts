import type { CategoryBreakdown } from "@/domain/types";

export const OTHER_CATEGORY_LABEL = "その他";

const TOP_CATEGORY_COUNT = 3;

const CATEGORY_COLOR_VARS = [
  "--series-category-1",
  "--series-category-2",
  "--series-category-3",
] as const;

export interface CategorySlice {
  category: string;
  grossProfit: number;
  colorVar: (typeof CATEGORY_COLOR_VARS)[number] | "--series-other";
}

/**
 * 区分別円グラフ用に、全社上位3区分＋その他へ折りたたむ。
 *
 * 上位3区分は必ず全社(company-wide)の内訳を基準に決め、CR別グラフでも同じ区分が
 * 同じ色になるようにする（色はエンティティに従う、ランクに従わない）。全社上位3区分に
 * 入らない区分は、そのCR内での大小に関わらず「その他」にまとめる（実データでは
 * 商品区分が9種以上あり、円グラフでの識別可能な系列数の上限を大きく超えるため）。
 */
export function buildCategorySlices(
  companyWideBreakdown: CategoryBreakdown[],
  targetBreakdown: CategoryBreakdown[]
): CategorySlice[] {
  const topCategories = companyWideBreakdown.slice(0, TOP_CATEGORY_COUNT).map((c) => c.category);

  const byCategory = new Map<string, number>();
  let otherTotal = 0;
  for (const { category, grossProfit } of targetBreakdown) {
    if (topCategories.includes(category)) {
      byCategory.set(category, (byCategory.get(category) ?? 0) + grossProfit);
    } else {
      otherTotal += grossProfit;
    }
  }

  const slices: CategorySlice[] = topCategories
    .map((category, i) => ({
      category,
      grossProfit: byCategory.get(category) ?? 0,
      colorVar: CATEGORY_COLOR_VARS[i],
    }))
    .filter((slice) => slice.grossProfit > 0);

  if (otherTotal > 0) {
    slices.push({ category: OTHER_CATEGORY_LABEL, grossProfit: otherTotal, colorVar: "--series-other" });
  }

  return slices;
}
