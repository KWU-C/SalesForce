import { formatYen } from "@/utils/format";
import type { MonthlyCashFlow } from "./types";
import type { LoanStatus } from "./loanStatus";
import type { FundReserve } from "./fundReserve";

interface ManagementSummaryProps {
  cashFlow: MonthlyCashFlow | null;
  loanStatus: LoanStatus | null;
  fundReserve: FundReserve | null;
  /** ネットキャッシュ(現預金－借入残高)。ページ側でfundReserve.cash・loanStatus.totalCurrentから合成して渡す */
  netCash: number | null;
}

function SummaryRow({
  label,
  description,
  value,
}: {
  label: string;
  description: string;
  value: number | null;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div>
        <p className="text-sm font-medium text-[var(--text-primary)]">{label}</p>
        <p className="text-xs text-[var(--text-muted)]">{description}</p>
      </div>
      <p className="shrink-0 text-lg font-semibold tabular-nums text-[var(--text-primary)]">
        {value === null ? "データ未設定" : formatYen(value)}
      </p>
    </div>
  );
}

function Arrow() {
  return (
    <div className="pl-1 text-[var(--text-muted)]" aria-hidden="true">
      ↓
    </div>
  );
}

/**
 * 経営サマリー。ページを開いて5秒程度で今月の資金状態を把握できることを目的に、
 * 下部の3セクション(月次資金収支・借入状況・資金の備え)を
 * 「営業キャッシュ収支→財務・将来準備→月末現預金→自由に使える現預金→
 * 借入残高→ネットキャッシュ」という一続きの流れとして俯瞰する
 * (ユーザー確定、2026-09-15)。単なる独立KPIカードの羅列にしない。
 *
 * ここでの数字は下部の詳細セクションと必ず同じデータソース・同じ計算関数の結果を
 * そのまま使い、UI側で別計算はしない(ユーザー確定)。PL上の「利益」とキャッシュを
 * 混同しないよう、当期累計(売上・利益等)はここに含めない(ユーザー確定)。
 */
export function ManagementSummary({ cashFlow, loanStatus, fundReserve, netCash }: ManagementSummaryProps) {
  const financingAndReserve =
    cashFlow !== null ? cashFlow.financingCashFlow + cashFlow.assetTransferCashFlow : null;

  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm font-medium text-[var(--text-secondary)]">経営サマリー</h2>
      <div className="rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)] p-4">
        <SummaryRow
          label="営業キャッシュ収支"
          description="今月、本業の入出金でいくら残ったか"
          value={cashFlow?.operatingCashFlow ?? null}
        />
        <Arrow />
        <SummaryRow
          label="財務・将来準備"
          description="当月の借入返済・積立等"
          value={financingAndReserve}
        />
        <Arrow />
        <SummaryRow label="月末現預金" description="現在の手元資金" value={cashFlow?.cashClosing ?? null} />
        <Arrow />
        <SummaryRow
          label="自由に使える現預金"
          description="現預金から、現預金内の目的準備資金を除いた金額"
          value={fundReserve?.freeCash ?? null}
        />
        <Arrow />
        <SummaryRow
          label="借入残高"
          description="短期・長期・役員借入金の現在残高"
          value={loanStatus?.totalCurrent ?? null}
        />
        <Arrow />
        <SummaryRow label="ネットキャッシュ" description="現預金－借入残高" value={netCash} />
      </div>
    </div>
  );
}
