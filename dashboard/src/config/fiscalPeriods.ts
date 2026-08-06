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

/** モック表示用の仮の事業期・対象月（要ユーザー確認、暦月表記） */
export const MOCK_FISCAL_PERIOD = {
  term: 50,
  currentMonth: 11,
};
