import { formatPercent, formatYen } from "@/utils/format";
import { fiscalYearToDateMonthsLabel } from "@/config/fiscalPeriods";
import { KpiTile } from "./KpiTile";
import { SectionBanner } from "./SectionBanner";
import { OperatingProfitTrendChart } from "./OperatingProfitTrendChart";
import { profitRate } from "./financialSummary";
import type { FinancialSummarySnapshot } from "./financialSummary";
import { provisionalPlMonths, provisionalPlNote } from "./businessBalanceRows";
import type { MonthlyPlPoint } from "./businessBalanceRows";

/** 利益率の補助表示。保存済みの率は旧算出(符号なし)の可能性があるため、常に金額から計算し直す */
function rateLabel(label: string, profit: number | null, revenue: number | null): string | undefined {
  const rate = profitRate(profit, revenue);
  return rate === null ? undefined : `${label} ${formatPercent(rate)}`;
}

interface FinancialSummaryCardsProps {
  /** monthはこのサマリーを取得した月(=累計の対象の終了月)。見出しに対象月を明記する */
  summary: FinancialSummarySnapshot;
  /** 事業期番号。事業収支の推移グラフの年表示(calendarYearForTermMonth)に使う */
  term: number;
  /** 9月〜当月の月次P/L。事業収支の推移グラフの元データ(ユーザー確定、2026-10-08)。未取得時は空配列で渡す */
  monthlyPl: MonthlyPlPoint[];
}

/**
 * 当期累計の経営サマリー。月次ダッシュボードが主役になったため、補助情報として
 * 画面下部に必要最小限だけ残す(ユーザー確定、2026-09-14。現預金・売掛金等の
 * 累計BS値や粗利パーヘッドは、月次CASH/PROFITセクションに一本化したためここでは表示しない)。
 */
export function FinancialSummaryCards({ summary, term, monthlyPl }: FinancialSummaryCardsProps) {
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
          subLabel={rateLabel("粗利率", summary.grossProfit, summary.revenue)}
        />
        <KpiTile
          title="営業利益"
          value={summary.operatingProfit}
          formatter={formatYen}
          subLabel={rateLabel("営業利益率", summary.operatingProfit, summary.revenue)}
        />
        <KpiTile title="経常利益" value={summary.ordinaryProfit} formatter={formatYen} />
      </div>
      <p className="text-xs text-[var(--text-muted)]">
        ※ {provisionalPlNote(summary.month)}
      </p>

      {monthlyPl.length > 0 && (
        <OperatingProfitTrendChart
          term={term}
          points={monthlyPl}
          provisionalMonths={provisionalPlMonths(summary.month)}
        />
      )}
    </div>
  );
}
