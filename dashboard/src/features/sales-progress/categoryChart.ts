import type { CategoryBreakdown } from "@/domain/types";
import { UNSPECIFIED_CATEGORY_LABEL } from "@/repositories/categoryBreakdown";

export const OTHER_CATEGORY_LABEL = "その他・未設定";

const TOP_CATEGORY_COUNT = 5;

const CATEGORY_COLOR_VARS = [
  "--series-category-1",
  "--series-category-2",
  "--series-category-3",
  "--series-category-4",
  "--series-category-5",
] as const;

export interface CategorySlice {
  category: string;
  grossProfit: number;
  colorVar: (typeof CATEGORY_COLOR_VARS)[number] | "--series-other";
}

/**
 * 区分別円グラフ用に、全社上位5区分＋その他へ折りたたむ（ユーザー確定、2026-09-01）。
 *
 * 上位5区分は必ず全社(company-wide)の内訳を基準に決め、CR別グラフでも同じ区分が
 * 同じ色になるようにする（色はエンティティに従う、ランクに従わない）。全社上位5区分に
 * 入らない区分は、そのCR内での大小に関わらず「その他」にまとめる。
 *
 * 色は5系列総当たり(all-pairs)でdataviz skillの検証をPASSする専用パレット
 * (--series-category-1〜5、globals.css)を使う。8色の標準パレットでは全ペア比較で
 * 5系列を安全に見分けられる組み合わせが数学的に存在しない（実測・全数探索で確認済み）
 * ため、既存の受注/完了/目標色(--series-1〜3)と重ならない色相をOKLCH色空間で
 * 別途探索し、ライト/ダーク両モードでCVD(色覚特性)・通常視ともに閾値をクリアする
 * 組み合わせを採用している。
 */
export function buildCategorySlices(
  companyWideBreakdown: CategoryBreakdown[],
  targetBreakdown: CategoryBreakdown[]
): CategorySlice[] {
  // 「未設定」は区分の入力漏れであり実区分ではないため、どれだけ粗利が大きくても
  // 上位5には入れず必ず「その他」側に合算する（ユーザー確定、2026-09-01）
  const topCategories = companyWideBreakdown
    .filter((c) => c.category !== UNSPECIFIED_CATEGORY_LABEL)
    .slice(0, TOP_CATEGORY_COUNT)
    .map((c) => c.category);

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
