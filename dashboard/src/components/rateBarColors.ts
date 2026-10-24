/**
 * 達成率バーの配色(注力クライアントの一覧と、営業進捗のCR別バーで共通。ユーザー指定、2026-10-24)。
 * 空欄部分は一段濃いグレー、100%以上は青、100%未満は赤。文字の色(--series-1・--status-serious)は変えない。
 */
export const RATE_BAR_TRACK_COLOR = "var(--gridline)";

export function rateBarFillColor(rate: number): string {
  return rate < 100 ? "#dc5b5b" : "#458ee7";
}
