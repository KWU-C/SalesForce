import { formatPercent, formatYen } from "@/utils/format";
import { fiscalYearToDateMonthsLabel } from "@/config/fiscalPeriods";
import { KpiTile } from "./KpiTile";
import { SectionBanner } from "./SectionBanner";
import { OperatingProfitTrendChart } from "./OperatingProfitTrendChart";
import type { FinancialSummarySnapshot } from "./financialSummary";
import type { OperatingProfitTrendPoint } from "./operatingProfitTrend";

interface FinancialSummaryCardsProps {
  /** monthはこのサマリーを取得した月(=累計の対象の終了月)。見出しに対象月を明記する */
  summary: FinancialSummarySnapshot;
  /** 事業期番号。営業利益推移グラフの年表示(calendarYearForTermMonth)に使う */
  term: number;
  /** 9月〜当月の累計営業利益推移(ユーザー確定、2026-09-22)。未取得時は空配列で渡す */
  operatingProfitTrend: OperatingProfitTrendPoint[];
}

/**
 * 当期累計の経営サマリー。月次ダッシュボードが主役になったため、補助情報として
 * 画面下部に必要最小限だけ残す(ユーザー確定、2026-09-14。現預金・売掛金等の
 * 累計BS値や粗利パーヘッドは、月次CASH/PROFITセクションに一本化したためここでは表示しない)。
 */
export function FinancialSummaryCards({ summary, term, operatingProfitTrend }: FinancialSummaryCardsProps) {
  return (
    <div className="flex flex-col gap-2">
      {/* 集計対象を明記: 期首(9月)から、このサマリーを取得した月まで(ユーザー確定、2026-09-19) */}
      <SectionBanner>当期累計（{fiscalYearToDateMonthsLabel(summary.month)}）</SectionBanner>
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

      {operatingProfitTrend.length > 0 && (
        <OperatingProfitTrendChart term={term} points={operatingProfitTrend} />
      )}
    </div>
  );
}
