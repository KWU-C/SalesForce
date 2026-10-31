import { RATE_BAR_TRACK_COLOR, rateBarFillColor } from "./rateBarColors";

/**
 * 達成率の小さいゲージ(営業進捗タブのCR別バーと同じ見た目、幅48px)。
 * 100%以上は満タン、100%未満はグレーの枠に達成分を塗る(色はrateBarFillColor)。
 * 達成率を出せない(null)ときはグレーの枠だけ。
 */
export function RateGauge({ rate }: { rate: number | null }) {
  return (
    <div
      className="h-1.5 w-12 shrink-0 overflow-hidden rounded-sm"
      style={{ backgroundColor: RATE_BAR_TRACK_COLOR }}
      aria-hidden
    >
      {rate !== null && (
        <div
          className="h-full"
          style={{
            width: `${Math.min(Math.max(rate, 0), 100)}%`,
            backgroundColor: rateBarFillColor(rate),
          }}
        />
      )}
    </div>
  );
}
