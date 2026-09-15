import { formatYen } from "@/utils/format";
import type { FundReserve } from "./fundReserve";

interface FundReserveSectionProps {
  fundReserve: FundReserve;
  /**
   * ネットキャッシュ算出用。借入状況セクションのtotalCurrentをそのまま渡す。
   * 借入状況が未取得(null)の場合は0円と推測せずnetCashを「データ未設定」にする
   */
  loanTotalCurrent: number | null;
}

function Line({
  label,
  value,
  indent = false,
  bold = false,
}: {
  label: string;
  /** nullの場合「データ未設定」と表示する(推測値は出さない、ユーザー確定の方針) */
  value: number | null;
  indent?: boolean;
  bold?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between py-1 text-sm ${indent ? "pl-4" : ""}`}>
      <span className={bold ? "font-medium text-[var(--text-primary)]" : "text-[var(--text-secondary)]"}>
        {label}
      </span>
      <span className={`tabular-nums ${bold ? "font-semibold text-[var(--text-primary)]" : "text-[var(--text-primary)]"}`}>
        {value === null ? "データ未設定" : formatYen(value)}
      </span>
    </div>
  );
}

/**
 * 資金の備え(ストック)。月次資金収支(フロー)とは別枠で、「将来の支出に向けて
 * どれだけ資金を準備しているか」を表す(ユーザー確定、2026-09-15)。
 *
 * 賞与準備は対象口座・目標額が確定するまで常に「未設定」(会計上の賞与引当金とは
 * 意味が異なるため推測しない)。自由資金・ネットキャッシュは意味が異なるため、
 * 単一の「資金余力」に統合せず別指標のまま表示する(ユーザー確定)。
 */
export function FundReserveSection({ fundReserve, loanTotalCurrent }: FundReserveSectionProps) {
  const netCash =
    fundReserve.cash === null || loanTotalCurrent === null ? null : fundReserve.cash - loanTotalCurrent;

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-sm font-medium text-[var(--text-secondary)]">資金の備え</h2>

      <div className="rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)] p-4">
        <p className="text-xs font-medium text-[var(--text-muted)]">目的準備資金</p>
        <Line
          label="賞与準備"
          value={fundReserve.bonusReserveConfigured ? fundReserve.bonusReserve : null}
          indent
        />
        <Line label="保険積立金" value={fundReserve.insuranceReserve} indent />
        {fundReserve.otherPurposeLines.map((line) => (
          <Line key={line.label} label={line.label} value={line.balance} indent />
        ))}
        <div className="mt-2 border-t border-[var(--gridline)] pt-2">
          <Line label="目的準備資金合計" value={fundReserve.purposeReserveTotal} bold />
        </div>

        <div className="mt-3 border-t-2 border-[var(--baseline)] pt-2">
          <p className="text-xs font-medium text-[var(--text-muted)]">資金余力</p>
          <Line label="現預金" value={fundReserve.cash} indent />
          <Line label="目的準備資金" value={fundReserve.purposeReserveTotal} indent />
          <Line label="自由資金（現預金－目的準備資金）" value={fundReserve.freeCash} indent bold />
          <Line label="ネットキャッシュ（現預金－借入残高）" value={netCash} indent bold />
        </div>
      </div>
    </div>
  );
}
