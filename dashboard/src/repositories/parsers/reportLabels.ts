import { FULL_YEAR, HALVES, QUARTERS } from "@/config/fiscalPeriods";

/**
 * 帳票形式（●CR別_月次営業まとめ 等）のシートから探索するラベル文字列。
 * 実際のシートのヘッダー文言が確認でき次第、ここだけを更新すればよい。
 *
 * 要確認: 「目標粗利」はユーザー指定のラベル一覧（受注/完了/売上/粗利/粗利達成率/
 * 各月/四半期等）には含まれていなかったが、粗利達成率をアプリ側で再計算する
 * （grossProfit ÷ targetGrossProfit）ためには目標値の列が必須のため、
 * 仮ラベルとして追加している。実シート確認時に正式な文言を確認すること。
 */
export const REPORT_LABELS = {
  order: "受注",
  completed: "完了",
  sales: "売上",
  grossProfit: "粗利",
  /** 要確認（上記コメント参照） */
  targetGrossProfit: "目標粗利",
  achievementRate: "粗利達成率",
} as const;

export function monthLabel(calendarMonth: number): string {
  return `${calendarMonth}月`;
}

/** 検算（検証用）にのみ使う。Domainの正データにはしない */
export const PERIOD_LABELS = [...QUARTERS, ...HALVES, FULL_YEAR].map((p) => p.label);

/** 粗利達成率の検算許容差（ポイント）。シート値とアプリ再計算値の差がこれを超えたら警告 */
export const ACHIEVEMENT_RATE_TOLERANCE_POINTS = 0.5;

/** 四半期・上半期・通期の粗利集計の検算許容差（円）。シート側集計値がある場合のみ使用 */
export const AMOUNT_TOLERANCE_YEN = 1;
