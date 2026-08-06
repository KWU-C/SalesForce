import type { MonthlyProgress } from "@/domain/types";
import { formatPercent, formatYen } from "@/utils/format";

interface MonthlyTableProps {
  title: string;
  data: MonthlyProgress[];
}

export function MonthlyTable({ title, data }: MonthlyTableProps) {
  return (
    <div className="rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)]">
      <h3 className="border-b border-[var(--border-hairline)] px-4 py-3 text-sm font-medium text-[var(--text-secondary)]">
        {title}（月別テーブル）
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="text-[var(--text-muted)]">
              <th className="px-4 py-2 text-left font-normal">月</th>
              <th className="px-4 py-2 text-right font-normal">売上</th>
              <th className="px-4 py-2 text-right font-normal">粗利</th>
              <th className="px-4 py-2 text-right font-normal">目標粗利</th>
              <th className="px-4 py-2 text-right font-normal">粗利達成率</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row) => {
              const grossProfit = row.grossProfit;
              return (
                <tr
                  key={row.month}
                  className="border-t border-[var(--gridline)] tabular-nums"
                >
                  <td className="px-4 py-2 text-[var(--text-primary)]">
                    {row.month}月
                  </td>
                  <td className="px-4 py-2 text-right text-[var(--text-primary)]">
                    {row.sales === null ? "—" : formatYen(row.sales)}
                  </td>
                  <td className="px-4 py-2 text-right text-[var(--text-primary)]">
                    {grossProfit === null ? "—" : formatYen(grossProfit)}
                  </td>
                  <td className="px-4 py-2 text-right text-[var(--text-secondary)]">
                    {formatYen(row.targetGrossProfit)}
                  </td>
                  <td className="px-4 py-2 text-right text-[var(--text-secondary)]">
                    {row.achievementRate === null ? "—" : formatPercent(row.achievementRate)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
