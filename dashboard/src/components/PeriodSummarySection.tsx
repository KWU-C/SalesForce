import type { PeriodSummary } from "@/domain/types";
import { formatPercent, formatYen } from "@/utils/format";

interface PeriodSummarySectionProps {
  title: string;
  summaries: PeriodSummary[];
}

export function PeriodSummarySection({
  title,
  summaries,
}: PeriodSummarySectionProps) {
  return (
    <section>
      <h3 className="mb-2 text-sm font-medium text-[var(--text-secondary)]">
        {title}
      </h3>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {summaries.map((summary) => (
          <div
            key={summary.label}
            className="rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)] p-3"
          >
            <p className="text-xs text-[var(--text-muted)]">{summary.label}</p>
            <p className="mt-1 text-base font-semibold text-[var(--text-primary)]">
              {summary.grossProfit === null ? "—" : formatYen(summary.grossProfit)}
            </p>
            <p className="text-[10px] text-[var(--text-muted)]">粗利</p>
            <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
              達成率 {summary.achievementRate === null ? "—" : formatPercent(summary.achievementRate)}
            </p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              売上 {summary.sales === null ? "—" : formatYen(summary.sales)}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
