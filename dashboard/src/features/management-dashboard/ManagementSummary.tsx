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
  fundReserve: FundReserve | null;
  /** ページ側で合成済みのネットキャッシュ(現預金－借入残高)。資金の備えセクションと同じ値を使う */
  netCash: number | null;
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
      <span className={`tabular-nums ${bold ? "font-semibold text-[var(--text-primary)]" : "text-[var(--text-primary)]"}`}>
        {formatted}
      </span>
    </div>
  );
}

/** 当期累計(KpiTile)と同じ大きさの見出し数字。手元資金・借入残高など最重要の値に使う */
function BigNumber({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <p className="text-sm text-[var(--text-secondary)]">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-[var(--text-primary)]">
        {value === null ? "データ未設定" : formatManYen(value)}
      </p>
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
 * 経営サマリー。下の3セクション(月次資金収支・資金の備え・借入状況)のダイジェストを
 * 表示する(ユーザー確定、2026-09-15)。
 *
 * レイアウト(ユーザー確定、2026-09-15):
 * 1段目: 手元資金(全幅)。月末現預金・自由に使える現預金を当期累計と同じ大きさの
 *   見出し数字で並べる
 * 2段目: 今月の資金収支・財務ポジションを半分ずつ。財務ポジションの借入残高も
 *   当期累計と同じ大きさの見出し数字にする
 *
 * ここでの数字は下部の詳細セクションと必ず同じデータソース・同じ計算関数の結果を
 * そのまま使い、UI側で別計算はしない(ユーザー確定)。「今月の資金収支」の内訳
 * (営業キャッシュ収支・借入返済・積立資産移動)の合計は、当月現金増減(trial_bs基準の
 * 真値)と完全には一致しない場合がある(月次資金収支表の「調整・未分類差額」と同じ理由。
 * ここでは強制的に一致させず、当月現金増減はcashChangeをそのまま表示する)。
 * PL上の「利益」とキャッシュを混同しないよう、当期累計(売上・利益等)はここに含めない
 * (ユーザー確定)。
 */
export function ManagementSummary({ term, month, cashFlow, loanStatus, fundReserve, netCash }: ManagementSummaryProps) {
  const calendarYear = calendarYearForTermMonth(term, month);

  return (
    <div className="flex flex-col gap-2">
      <SectionBanner>
        経営サマリー　{calendarYear}年{month}月
      </SectionBanner>

      <div className="flex flex-col gap-3">
        <SummaryBox title="手元資金">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <BigNumber label="月末現預金" value={cashFlow?.cashClosing ?? null} />
            <BigNumber label="自由に使える現預金" value={fundReserve?.freeCash ?? null} />
          </div>
          <div className="mt-3 border-t border-[var(--gridline)] pt-2">
            <Row label="うち目的準備資金" value={fundReserve?.cashRestrictedTotal ?? null} />
          </div>
        </SummaryBox>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <SummaryBox title="今月の資金収支">
            <Row label="営業キャッシュ収支" value={cashFlow?.operatingCashFlow ?? null} signed />
            <Row label="当月元本返済" value={cashFlow?.financingCashFlow ?? null} signed />
            <Row label="支払利息" value={cashFlow?.interestCashFlow ?? null} signed />
            <Row label="積立・資産移動" value={cashFlow?.assetTransferCashFlow ?? null} signed />
            <div className="mt-1 border-t border-[var(--gridline)] pt-1">
              <Row label="当月現金増減" value={cashFlow?.cashChange ?? null} signed bold />
            </div>
          </SummaryBox>

          <SummaryBox title="財務ポジション">
            <BigNumber label="借入残高" value={loanStatus?.totalCurrent ?? null} />
            <div className="mt-3 border-t border-[var(--gridline)] pt-2">
              <Row label="ネットキャッシュ" value={netCash} signed bold />
            </div>
          </SummaryBox>
        </div>
      </div>
    </div>
  );
}
