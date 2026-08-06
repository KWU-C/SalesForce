/**
 * 事業期の月区分設定
 *
 * TCDの事業年度は9月開始（ユーザー確定、2026-08-06）。
 * 暦月を9月始まりの順序に並べ替えて四半期・上半期を区切っている。
 */

/** 事業年度内の月順（暦月）。インデックス0が期首月＝9月 */
export const FISCAL_MONTH_ORDER: number[] = [9, 10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8];

/** 暦月から事業年度内の月インデックス(1〜12、9月=1)を求める */
export function fiscalMonthIndex(calendarMonth: number): number {
  return FISCAL_MONTH_ORDER.indexOf(calendarMonth) + 1;
}

export const QUARTERS: { label: string; months: number[] }[] = [
  { label: "第1四半期", months: [9, 10, 11] },
  { label: "第2四半期", months: [12, 1, 2] },
  { label: "第3四半期", months: [3, 4, 5] },
  { label: "第4四半期", months: [6, 7, 8] },
];

export const HALVES: { label: string; months: number[] }[] = [
  { label: "上半期", months: [9, 10, 11, 12, 1, 2] },
  { label: "下半期", months: [3, 4, 5, 6, 7, 8] },
];

export const FULL_YEAR: { label: string; months: number[] } = {
  label: "通期",
  months: [...FISCAL_MONTH_ORDER],
};

/**
 * 49期の期首（2025年9月1日）。事業期の起算点として使う。
 * ユーザー確定（2026-08-06、事業年度は9月始まり〜8月末、今年は49期）。
 */
const FISCAL_TERM_ANCHOR = { term: 49, year: 2025, month: 9 }; // month: 1〜12（Dateのmonthは0始まりでない実際の月）

/**
 * 現在時刻から事業期・対象月（暦月）を動的に算出する。
 * 固定値をハードコードすると翌月以降ズレるため、必ずこの関数経由で取得する。
 */
export function getCurrentFiscalPeriod(now: Date = new Date()): { term: number; currentMonth: number } {
  const currentMonth = now.getMonth() + 1; // 1〜12
  const monthsSinceAnchor =
    (now.getFullYear() - FISCAL_TERM_ANCHOR.year) * 12 +
    (currentMonth - FISCAL_TERM_ANCHOR.month);
  const termsElapsed = Math.floor(monthsSinceAnchor / 12);

  return { term: FISCAL_TERM_ANCHOR.term + termsElapsed, currentMonth };
}
