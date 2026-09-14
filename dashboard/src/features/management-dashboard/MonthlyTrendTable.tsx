import { formatYen } from "@/utils/format";
import type { MonthlyFinanceSnapshot } from "./types";

interface MonthlyTrendTableProps {
  snapshots: MonthlyFinanceSnapshot[];
}

function cell(value: number | null): string {
  return value === null ? "—" : formatYen(value);
}

/** 9月〜8月の月次推移表。まだ到来していない月はそもそもsnapshotsに含まれない(呼び出し元で除外済み) */
export function MonthlyTrendTable({ snapshots }: MonthlyTrendTableProps) {
  if (snapshots.length === 0) {
    return <p className="text-sm text-[var(--text-muted)]">表示できる月がありません。</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-[var(--border-hairline)] text-left text-[var(--text-secondary)]">
            <th className="py-1 pr-3 font-medium">月</th>
            <th className="py-1 pr-3 font-medium">売上高</th>
            <th className="py-1 pr-3 font-medium">粗利益</th>
            <th className="py-1 pr-3 font-medium">営業利益</th>
            <th className="py-1 pr-3 font-medium">月末現預金</th>
          </tr>
        </thead>
        <tbody>
          {snapshots.map((s) => (
            <tr key={`${s.fiscalYear}-${s.month}`} className="border-b border-[var(--gridline)]">
              <td className="py-1 pr-3 text-[var(--text-primary)]">{s.month}月</td>
              <td className="py-1 pr-3">{cell(s.sales)}</td>
              <td className="py-1 pr-3">{cell(s.grossProfit)}</td>
              <td className="py-1 pr-3">{cell(s.operatingProfit)}</td>
              <td className="py-1 pr-3">{cell(s.cashClosing)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
