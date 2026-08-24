import { formatPercent, formatYen } from "@/utils/format";

interface StatCardProps {
  title: string;
  sales: number | null;
  grossProfit: number | null;
  targetGrossProfit: number;
  achievementRate: number | null;
}

function statusColor(rate: number): string | undefined {
  if (rate < 0) return "var(--status-serious)";
  return undefined;
}

export function StatCard({
  title,
  sales,
  grossProfit,
  targetGrossProfit,
  achievementRate,
}: StatCardProps) {
  return (
    <div className="rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)] p-4">
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
      <div className="mt-3 flex items-center justify-between border-t border-[var(--gridline)] pt-2 text-sm">
        <span className="text-[var(--text-secondary)]">売上</span>
        <span className="font-medium text-[var(--text-primary)]">
          {sales === null ? "—" : formatYen(sales)}
        </span>
      </div>
    </div>
  );
}
