/**
 * 達成率バーの配色(注力クライアントの一覧と、営業進捗のCR別バーで共通。ユーザー指定、2026-10-24)。
 * 空欄部分は一段濃いグレー。塗りは80%以上が青、50%以上80%未満がオレンジ、50%未満が赤。
 * 文字の色(--series-1・--status-serious)は変えない。
 */
export const RATE_BAR_TRACK_COLOR = "var(--gridline)";

export function rateBarFillColor(rate: number): string {
  if (rate >= 80) return "#458ee7";
  if (rate >= 50) return "#d07d1b";
  return "#dc5b5b";
}
