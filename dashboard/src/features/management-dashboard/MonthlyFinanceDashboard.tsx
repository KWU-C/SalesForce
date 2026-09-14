import { formatPercent, formatYen } from "@/utils/format";
import { KpiTile } from "./KpiTile";
import { RefreshMonthButton } from "./RefreshMonthButton";
import type { MonthlyFinanceSnapshot } from "./types";
import type { SalesInputSummary } from "./salesInputSummary";

interface MonthlyFinanceDashboardProps {
  fiscalYear: number;
  month: number;
  salesInput: SalesInputSummary;
  finance: MonthlyFinanceSnapshot | null;
}

/**
 * 月次経営ダッシュボードの本体。INPUT(受注/売上)→OUTPUT(費用)→PROFIT(利益)→CASH(資金)
 * の流れで、選択した1ヶ月の経営状態を一画面で把握できるようにする(ユーザー確定、2026-09-14)。
 * freeeの試算表をそのまま複製せず、経営判断に必要な数字だけへ再編集している。
 */
export function MonthlyFinanceDashboard({ fiscalYear, month, salesInput, finance }: MonthlyFinanceDashboardProps) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-[var(--text-secondary)]">今月の経営状態</h2>
        <RefreshMonthButton fiscalYear={fiscalYear} month={month} />
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium text-[var(--text-secondary)]">
          INPUT（今月どれだけ仕事・売上が入ったか）
        </h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <KpiTile title="受注（粗利）" value={salesInput.orderGrossProfit} formatter={formatYen} />
          <KpiTile title="受注（売上）" value={salesInput.orderSales} formatter={formatYen} />
          <KpiTile title="売上高（会計上）" value={finance?.sales ?? null} formatter={formatYen} />
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium text-[var(--text-secondary)]">
          OUTPUT（今月何にコストを使ったか）
        </h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <KpiTile title="労務費" value={finance?.laborCost ?? null} formatter={formatYen} />
          <KpiTile title="外注費" value={finance?.outsourcingCost ?? null} formatter={formatYen} />
          <KpiTile title="その他販管費" value={finance?.otherSga ?? null} formatter={formatYen} />
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium text-[var(--text-secondary)]">PROFIT（今月どれだけ残ったか）</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <KpiTile title="粗利益" value={finance?.grossProfit ?? null} formatter={formatYen} />
          <KpiTile title="粗利率" value={finance?.grossMargin ?? null} formatter={(v) => formatPercent(v)} />
          <KpiTile title="営業利益" value={finance?.operatingProfit ?? null} formatter={formatYen} />
          <KpiTile
            title="営業利益率"
            value={finance?.operatingMargin ?? null}
            formatter={(v) => formatPercent(v)}
          />
          <KpiTile title="経常利益" value={finance?.ordinaryProfit ?? null} formatter={formatYen} />
          {/* 対象人数データソース未接続のため常に「データ未設定」(次フェーズ、ユーザー確定) */}
          <KpiTile title="粗利パーヘッド（月額）" value={null} formatter={formatYen} subLabel="対象人数データ未接続" />
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium text-[var(--text-secondary)]">CASH（資金状態）</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <KpiTile title="月初現預金" value={finance?.cashOpening ?? null} formatter={formatYen} />
          <KpiTile title="月末現預金" value={finance?.cashClosing ?? null} formatter={formatYen} />
          <KpiTile title="当月増減" value={finance?.cashChange ?? null} formatter={formatYen} />
          <KpiTile title="売掛金" value={finance?.accountsReceivable ?? null} formatter={formatYen} />
          <KpiTile
            title="買掛金・未払金"
            value={
              finance?.accountsPayable !== null && finance?.accountsPayable !== undefined
                ? finance.accountsPayable + (finance.unpaidExpenses ?? 0)
                : null
            }
            formatter={formatYen}
          />
          <KpiTile title="借入金" value={finance?.borrowings ?? null} formatter={formatYen} />
        </div>
      </div>
    </div>
  );
}
