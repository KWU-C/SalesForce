/**
 * Google Sheetsのセル文字列を値へ変換する共通パーサー。
 * normalizedTableParser・帳票形式Parser（repositories/parsers/）の両方から利用する。
 */

/** "9月" "9" " 9 " のような文字列から月(1〜12)を取り出す。解釈できなければnull */
export function parseMonth(raw: string | undefined): number | null {
  if (!raw) return null;
  const match = raw.match(/\d{1,2}/);
  if (!match) return null;
  const month = Number(match[0]);
  return month >= 1 && month <= 12 ? month : null;
}

/** "¥1,234,567" "1,234,567" のような文字列を数値化する。空・不正値は0 */
export function parseNumber(raw: string | undefined): number {
  if (!raw) return 0;
  const cleaned = raw.replace(/[^\d.-]/g, "");
  if (cleaned === "") return 0;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : 0;
}

/**
 * "¥1,234,567" のような文字列を数値化する。空欄は「未入力」としてnullを返す
 * （0とは区別する。parseNumberと違い、空欄を0に丸めない）。数値化できない
 * 文字列もnullを返す。
 */
export function parseNumberOrNull(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === "") return null;
  const cleaned = raw.replace(/[^\d.-]/g, "");
  if (cleaned === "") return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}
