import type { CategoryBreakdown, CrId } from "@/domain/types";

/**
 * SOQL集計クエリ（buildOrderCategoryBreakdownQuery）の1行。
 * shohinkubun__c(商品区分)は通常のpicklistでライセンス制約・エイリアス制約を
 * 受けないため、リーダーランキングと同様に集計クエリの結果をそのまま受け取れる。
 */
export interface CategoryAggregateRow {
  crId: string;
  category: string | null;
  grossProfit: number;
}

const UNSPECIFIED_CATEGORY_LABEL = "未設定";

/**
 * 商品区分別に集計行を合算し、粗利降順で返す。
 * ALLはCRをまたいで同一区分を合算し直す。区分未設定(null)は「未設定」としてまとめる
 * （区分の入力漏れも可視化する、ユーザー確認2026-09-01の区分別内訳の一部）。
 */
export function aggregateCategoryBreakdown(
  rows: CategoryAggregateRow[],
  crId: CrId
): CategoryBreakdown[] {
  const inScope = crId === "ALL" ? rows : rows.filter((r) => r.crId === crId);

  const byCategory = new Map<string, number>();
  for (const row of inScope) {
    const label = row.category ?? UNSPECIFIED_CATEGORY_LABEL;
    byCategory.set(label, (byCategory.get(label) ?? 0) + row.grossProfit);
  }

  return [...byCategory.entries()]
    .map(([category, grossProfit]) => ({ category, grossProfit }))
    .sort((a, b) => b.grossProfit - a.grossProfit);
}
