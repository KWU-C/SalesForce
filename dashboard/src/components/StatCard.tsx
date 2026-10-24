import { formatPercent, formatYen } from "@/utils/format";
import { RATE_BAR_TRACK_COLOR, rateBarFillColor } from "./rateBarColors";

interface StatCardProps {
  title: string;
  sales: number | null;
  grossProfit: number | null;
  targetGrossProfit: number;
  achievementRate: number | null;
  /** 指定時、売上の下に罫線を引き、CRごとの粗利達成率をバー・CR名・%で横一列に並べる(全社タブの当月受注・完了用) */
  crRates?: { label: string; rate: number | null }[];
}

function statusColor(rate: number): string | undefined {
  if (rate < 100) return "var(--status-serious)";
  return undefined;
}

export function StatCard({
  title,
  sales,
  grossProfit,
  targetGrossProfit,
  achievementRate,
  crRates,
}: StatCardProps) {
  return (
    <div className="h-full rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)] p-4">
      <p className="text-sm text-[var(--text-secondary)]">{title}</p>
      <p className="mt-1 text-2xl font-semibold text-[var(--text-primary)]">
        {grossProfit === null ? "—" : formatYen(grossProfit)}
      </p>
      <p className="text-xs text-[var(--text-muted)]">粗利</p>
      <div className="mt-2 flex items-center justify-between text-sm">
        <span className="text-[var(--text-muted)]">
          目標粗利 {formatYen(targetGrossProfit)}
        </span>
        <span
          className="font-medium"
          style={achievementRate === null ? undefined : { color: statusColor(achievementRate) }}
        >
          粗利達成率 {achievementRate === null ? "—" : formatPercent(achievementRate)}
        </span>
      </div>
      <div className="mt-3 border-t border-[var(--gridline)] pt-2 text-left">
        <p className="text-lg font-medium text-[var(--text-primary)]">
          {sales === null ? "—" : formatYen(sales)}
        </p>
        <p className="text-xs text-[var(--text-muted)]">売上</p>
      </div>
      {crRates && (
        <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 border-t lg:grid-cols-4 border-[var(--gridline)] pt-3">
          {crRates.map(({ label, rate }) => (
            <CrRateBar key={label} label={label} rate={rate} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * 注力クライアントの達成率バーの小型版(ユーザー指示、2026-10-24)。「CR名・バー・%」の順に並べ、文字は小さく(10px)する。
 * CRごとの間隔は24px、CR名・バー・%の間は3px(ユーザー指示、2026-10-24)。
 * 100%以上は満タン、100%未満はグレーの枠(100%)に達成分を塗る(色はrateBarFillColor)。%の文字色は粗利達成率と同じ(100%未満は赤)。
 * 目標が無く達成率を出せないCRはグレーの枠だけで、%は「—」。
 */
function CrRateBar({ label, rate }: { label: string; rate: number | null }) {
  return (
    <div className="flex min-w-0 items-center gap-[3px] whitespace-nowrap">
      <span className="text-[10px] text-[var(--text-muted)]">{label}</span>
      <div className="h-1.5 min-w-6 flex-1 overflow-hidden rounded-sm" style={{ backgroundColor: RATE_BAR_TRACK_COLOR }} aria-hidden>
        {rate !== null && (
          <div
            className="h-full"
            style={{ width: `${Math.min(Math.max(rate, 0), 100)}%`, backgroundColor: rateBarFillColor(rate) }}
          />
        )}
      </div>
      <span
        className="text-[10px] text-[var(--text-secondary)]"
        style={rate === null ? undefined : { color: statusColor(rate) }}
      >
        {rate === null ? "—" : formatPercent(rate)}
      </span>
    </div>
  );
}
