import { formatYen } from "@/utils/format";
import { SectionBanner } from "./SectionBanner";
import type { FundReserve } from "./fundReserve";

interface FundReserveSectionProps {
  fundReserve: FundReserve;
  /** 借入状況セクションのtotalCurrentをそのまま渡す */
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
 * 「現預金の使途」「現預金外の備え」「資金余力」の3ブロックに分ける
 * (ユーザー確定、2026-09-21)。
 * - 現預金の使途: 賞与準備・その他目的資金(現預金内の目的別拘束資金の内訳)とその合計。
 *   賞与準備は対象口座・目標額が確定するまで常に「未設定」(会計上の賞与引当金とは
 *   意味が異なるため推測しない、ユーザー確定)。その他目的資金は口座ごとの内訳を
 *   合算した1行で表示する。
 * - 現預金外の備え: 保険積立金。trial_bsの「現金・預金」カテゴリには一切含まれないため、
 *   現預金からは控除しない別枠の「資産としての備え」(二重控除防止、実データで検証済み、
 *   2026-09-15)。
 * - 資金余力: 現預金→自由資金→ネット自由資金への「差し引きの流れ」を見せる
 *   (目的準備資金・借入残高はマイナス表示にして、引き算であることを視覚的に示す)。
 *   自由資金 = 現預金 − 現預金内目的準備資金合計。ネット自由資金 = 自由資金 − 借入残高。
 */
export function FundReserveSection({ fundReserve, loanTotalCurrent }: FundReserveSectionProps) {
  const otherPurposeTotal = fundReserve.otherPurposeLines.reduce((sum, line) => sum + (line.balance ?? 0), 0);
  const netFreeCash =
    fundReserve.freeCash === null || loanTotalCurrent === null ? null : fundReserve.freeCash - loanTotalCurrent;

  return (
    <div className="flex flex-col gap-3">
      <SectionBanner>資金の備え</SectionBanner>

      <div className="rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)] p-4">
        <p className="text-xs font-medium text-[var(--text-muted)]">現預金の使途</p>
        <Line
          label="賞与準備"
          value={fundReserve.bonusReserveConfigured ? fundReserve.bonusReserve : null}
          indent
        />
        <Line label="その他目的資金" value={otherPurposeTotal} indent />
        <div className="mt-2 border-t border-[var(--gridline)] pt-2">
          <Line label="目的準備資金合計" value={fundReserve.cashRestrictedTotal} bold />
        </div>

        <div className="mt-3 border-t border-[var(--gridline)] pt-2">
          <p className="text-xs font-medium text-[var(--text-muted)]">現預金外の備え</p>
          <Line label="保険積立金" value={fundReserve.insuranceAssetReserve} indent />
        </div>

        <div className="mt-3 border-t-2 border-[var(--baseline)] pt-2">
          <p className="text-xs font-medium text-[var(--text-muted)]">資金余力</p>
          <Line label="現預金" value={fundReserve.cash} indent />
          <Line label="目的準備資金" value={-fundReserve.cashRestrictedTotal} indent />
          <Line label="自由資金" value={fundReserve.freeCash} indent bold />
          <Line label="借入残高" value={loanTotalCurrent === null ? null : -loanTotalCurrent} indent />
          <Line label="ネット自由資金" value={netFreeCash} indent bold />
        </div>
      </div>
    </div>
  );
}
