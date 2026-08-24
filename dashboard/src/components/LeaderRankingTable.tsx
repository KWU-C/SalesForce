import type { LeaderRanking } from "@/domain/types";
import { formatThousandYen } from "@/utils/format";

interface LeaderRankingTableProps {
  title: string;
  leaders: LeaderRanking[];
  /** 見出し・順位の色。既存の受注(--series-1)/完了(--series-2)を再利用する */
  accentColorVar: "--series-1" | "--series-2";
}

export function LeaderRankingTable({ title, leaders, accentColorVar }: LeaderRankingTableProps) {
  return (
    <div className="rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)]">
      <div className="flex items-baseline justify-between border-b border-[var(--border-hairline)] px-4 py-3">
        <h3 className="text-sm font-medium text-[var(--text-secondary)]">{title}</h3>
        <span className="text-xs text-[var(--text-muted)]">単位：千円</span>
      </div>
      {leaders.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-[var(--text-muted)]">対象データなし</p>
      ) : (
        <table className="w-full text-sm tabular-nums">
          <tbody>
            {leaders.map((leader, i) => (
              <tr key={leader.leaderId} className="border-t border-[var(--gridline)] first:border-t-0">
                <td
                  className="w-10 px-4 py-1.5 text-right font-medium"
                  style={{ color: `var(${accentColorVar})` }}
                >
                  {i + 1}
                </td>
                <td className="px-2 py-1.5 text-left text-[var(--text-primary)]">{leader.leaderName}</td>
                <td className="px-4 py-1.5 text-right font-medium text-[var(--text-primary)]">
                  {formatThousandYen(leader.grossProfit)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
