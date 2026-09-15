import { formatYen } from "@/utils/format";
import type { LoanStatus } from "./loanStatus";

interface LoanStatusTableProps {
  loanStatus: LoanStatus;
}

/**
 * 借入状況(ストック)。月次資金収支(フロー)とは別枠で表示する(ユーザー確定、2026-09-15)。
 * 目的は「借入がいくらあるか」ではなく「今期、借金をどれだけ減らせているか」を把握すること。
 */
export function LoanStatusTable({ loanStatus }: LoanStatusTableProps) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-sm font-medium text-[var(--text-secondary)]">借入状況</h2>

      <div className="overflow-x-auto rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)] p-4">
        <table className="w-full min-w-[420px] text-sm">
          <thead>
            <tr className="text-left text-xs text-[var(--text-muted)]">
              <th className="py-1 font-normal">科目</th>
              <th className="py-1 text-right font-normal">期首残高</th>
              <th className="py-1 text-right font-normal">現在残高</th>
              <th className="py-1 text-right font-normal">今期返済</th>
            </tr>
          </thead>
          <tbody>
            {loanStatus.lines.map((line) => (
              <tr key={line.key} className="border-t border-[var(--gridline)]">
                <td className="py-1.5 text-[var(--text-secondary)]">{line.label}</td>
                <td className="py-1.5 text-right tabular-nums text-[var(--text-primary)]">
                  {formatYen(line.openingBalance)}
                </td>
                <td className="py-1.5 text-right tabular-nums text-[var(--text-primary)]">
                  {formatYen(line.currentBalance)}
                </td>
                <td className="py-1.5 text-right tabular-nums text-[var(--text-primary)]">
                  {formatYen(line.repayment)}
                </td>
              </tr>
            ))}
            <tr className="border-t-2 border-[var(--baseline)] font-semibold">
              <td className="py-1.5 text-[var(--text-primary)]">合計</td>
              <td className="py-1.5 text-right tabular-nums text-[var(--text-primary)]">
                {formatYen(loanStatus.totalOpening)}
              </td>
              <td className="py-1.5 text-right tabular-nums text-[var(--text-primary)]">
                {formatYen(loanStatus.totalCurrent)}
              </td>
              <td className="py-1.5 text-right tabular-nums text-[var(--text-primary)]">
                {formatYen(loanStatus.totalRepayment)}
              </td>
            </tr>
          </tbody>
        </table>

        <div className="mt-3 flex flex-col gap-1 border-t border-[var(--gridline)] pt-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-[var(--text-secondary)]">今期新規借入</span>
            <span className="tabular-nums text-[var(--text-primary)]">{formatYen(loanStatus.totalNewBorrowing)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[var(--text-secondary)]">今期返済累計</span>
            <span className="tabular-nums text-[var(--text-primary)]">{formatYen(loanStatus.totalRepayment)}</span>
          </div>
          <div className="flex items-center justify-between font-semibold">
            <span className="text-[var(--text-primary)]">借入純増減</span>
            <span className="tabular-nums text-[var(--text-primary)]">{formatYen(loanStatus.netChange)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
