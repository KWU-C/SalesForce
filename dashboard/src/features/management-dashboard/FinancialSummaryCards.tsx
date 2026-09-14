import { formatPercent, formatYen } from "@/utils/format";
import { KpiTile } from "./KpiTile";
import type { FinancialSummary } from "./financialSummary";

interface FinancialSummaryCardsProps {
  summary: FinancialSummary;
}

/**
 * 当期累計の経営サマリー。月次ダッシュボードが主役になったため、補助情報として
 * 画面下部に必要最小限だけ残す(ユーザー確定、2026-09-14。現預金・売掛金等の
 * 累計BS値や粗利パーヘッドは、月次CASH/PROFITセクションに一本化したためここでは表示しない)。
 */
export function FinancialSummaryCards({ summary }: FinancialSummaryCardsProps) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-medium text-[var(--text-secondary)]">当期累計（参考）</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile title="売上高" value={summary.revenue} formatter={formatYen} />
        <KpiTile
          title="粗利益"
          value={summary.grossProfit}
          formatter={formatYen}
          subLabel={summary.grossProfitRate === null ? undefined : `粗利率 ${formatPercent(summary.grossProfitRate)}`}
        />
        <KpiTile
          title="営業利益"
          value={summary.operatingProfit}
          formatter={formatYen}
          subLabel={
            summary.operatingProfitRate === null
              ? undefined
              : `営業利益率 ${formatPercent(summary.operatingProfitRate)}`
          }
        />
        <KpiTile title="経常利益" value={summary.ordinaryProfit} formatter={formatYen} />
      </div>
    </div>
  );
}
