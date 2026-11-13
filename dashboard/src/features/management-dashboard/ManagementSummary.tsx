import { calendarYearForTermMonth } from "@/config/fiscalPeriods";
import { formatManYen, formatManYenSigned } from "@/utils/format";
import { SectionBanner } from "./SectionBanner";
import type { MonthlyCashFlow } from "./types";
import type { LoanStatus } from "./loanStatus";
import type { FundReserve } from "./fundReserve";

interface ManagementSummaryProps {
  term: number;
  month: number;
  cashFlow: MonthlyCashFlow | null;
  loanStatus: LoanStatus | null;
  /** 資金余力は資金の備えと同じ composeFundReserve の結果(capacity.capacity)をそのまま表示する */
  fundReserve: FundReserve | null;
}

function Row({
  label,
  value,
  signed = false,
  bold = false,
}: {
  label: string;
  value: number | null;
  signed?: boolean;
  bold?: boolean;
}) {
  const formatted = value === null ? "データ未設定" : signed ? formatManYenSigned(value) : formatManYen(value);
  return (
    <div className="flex items-center justify-between gap-3 py-1 text-sm">
      <span className={bold ? "font-medium text-[var(--text-primary)]" : "text-[var(--text-secondary)]"}>
        {label}
      </span>
      <span className={`whitespace-nowrap tabular-nums ${bold ? "font-semibold text-[var(--text-primary)]" : "text-[var(--text-primary)]"}`}>
        {formatted}
      </span>
    </div>
  );
}

/** 当期累計(KpiTile)と同じ大きさの見出し数字。ラベル左・金額右(ユーザー確定、2026-09-15) */
function BigRow({ label, value, signed = false }: { label: string; value: number | null; signed?: boolean }) {
  const formatted = value === null ? "データ未設定" : signed ? formatManYenSigned(value) : formatManYen(value);
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-[var(--text-secondary)]">{label}</span>
      <span className="text-2xl font-semibold tabular-nums text-[var(--text-primary)]">{formatted}</span>
    </div>
  );
}

function SummaryBox({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)] p-4">
      <p className="mb-2 text-xs font-medium text-[var(--text-muted)]">{title}</p>
      {children}
    </div>
  );
}

/**
 * 現在の資金収支・借入・資金余力(概要の補助情報、2026-11-13に整理)。いずれも当月・freee取得時点の値で、
 * 下の詳細タブ(入出金明細・財務・資金繰り)と同じデータ・同じ計算関数の結果をそのまま使い、ここでは別計算しない
 * (実質借入残高 = 借入残高 − 月末現預金 のみ、従来どおりここで求める)。
 * 月末現預金と先月の残高は、概要の資金サマリー(前月末実績/現在の比較)へ移した。
 * 各ボックスは「タイトル→項目名+大きい文字の数字→hr→小さい文字で補足情報」(ユーザー確定、2026-09-16)。
 */
export function ManagementSummary({ term, month, cashFlow, loanStatus, fundReserve }: ManagementSummaryProps) {
  const calendarYear = calendarYearForTermMonth(term, month);
  // 実質借入残高 = 借入残高 − 月末現預金(資金の備えの「ネットキャッシュ」の符号違い)。現預金の方が多い場合はマイナス
  const loanTotal = loanStatus?.totalCurrent ?? null;
  const cashClosing = cashFlow?.cashClosing ?? null;
  const netDebt = loanTotal === null || cashClosing === null ? null : loanTotal - cashClosing;
  const capacity = fundReserve?.capacity ?? null;

  return (
    <div className="flex flex-col gap-2">
      <SectionBanner>
        現在の資金収支・借入・資金余力　{calendarYear}年{month}月（当月途中・freee取得時点）
      </SectionBanner>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SummaryBox title="今月の資金収支">
          <BigRow label="当月現金増減" value={cashFlow?.cashChange ?? null} signed />
          <div className="mt-3 border-t border-[var(--gridline)] pt-2">
            <Row label="うち営業収支" value={cashFlow?.operatingCashFlow ?? null} signed />
          </div>
        </SummaryBox>

        <SummaryBox title="借入状況">
          <BigRow label="借入残高" value={loanStatus?.totalCurrent ?? null} />
          <div className="mt-3 border-t border-[var(--gridline)] pt-2">
            <Row label="今期借入純増減" value={loanStatus?.netChange ?? null} signed bold />
            <Row label="実質借入残高（借入−現預金）" value={netDebt} />
          </div>
        </SummaryBox>

        <SummaryBox title="資金余力（経理管理上の実質資金）">
          <BigRow label="資金余力" value={capacity?.capacity ?? null} />
          <div className="mt-3 border-t border-[var(--gridline)] pt-2">
            <p className="text-xs text-[var(--text-muted)]">
              現預金総額 − 当座貸越利用額 − 消費税準備 − 賞与準備
              {capacity?.settingsAsOf ? `（準備額は${capacity.settingsAsOf}時点の経理の管理値）` : "（準備額は経理の管理値）"}
            </p>
          </div>
        </SummaryBox>
      </div>
    </div>
  );
}
