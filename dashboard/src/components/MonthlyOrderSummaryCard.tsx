import { StatCard } from "@/components/StatCard";
import type { MonthlyProgress } from "@/domain/types";
import type { ConfidenceForecast } from "@/features/sales-progress/pipelineGrouping";
import { formatYen } from "@/utils/format";

interface MonthlyOrderSummaryCardProps {
  /** 当月（暦月） */
  currentMonth: number;
  /** 当該CRの当月の受注確定分。未到来・データなしはnull */
  confirmedOrder: MonthlyProgress | null;
  /**
   * 受注確度A(80〜100%)の未確定案件(提案・見積)のうち、受注予定日が当月のものの合算。
   * 「◯月の受注（確定分）」には含まれない。対象なしはnull
   */
  confidenceAForecast: ConfidenceForecast | null;
  /** 受注確度B版（集計基準は確度Aと同じ）。対象なしはnull */
  confidenceBForecast: ConfidenceForecast | null;
}

function ConfidenceForecastStat({
  title,
  forecast,
}: {
  title: string;
  forecast: ConfidenceForecast | null;
}) {
  return (
    <div className="flex-1 rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)] p-4">
      <p className="text-sm text-[var(--text-secondary)]">{title}</p>
      <p className="mt-1 text-2xl font-semibold text-[var(--text-primary)]">
        {forecast === null ? "—" : formatYen(forecast.grossProfit)}
      </p>
      <p className="text-xs text-[var(--text-muted)]">粗利</p>
      {/* StatCardの目標粗利・達成率の行と天地を揃えるための不可視スペーサー(内容は同じ高さのダミー) */}
      <div className="invisible mt-2 flex items-center justify-between text-sm" aria-hidden="true">
        <span>目標粗利 —</span>
      </div>
      <div className="mt-3 border-t border-[var(--gridline)] pt-2 text-left">
        <p className="text-lg font-medium text-[var(--text-primary)]">
          {forecast === null ? "—" : formatYen(forecast.sales)}
        </p>
        <p className="text-xs text-[var(--text-muted)]">売上</p>
      </div>
    </div>
  );
}

/**
 * 当月の受注を「確定分」「確度A」「確度B」の3枚で並べる（ユーザー確定、2026-10-01）。
 * 確定分は受注確定フェーズの実績(目標・達成率つき)、確度A・Bは当月の受注予測に入っているが
 * 未確定(提案・見積)の分で、互いに重複しない。確定分が左半分、確度A・Bが右半分を等分する。
 */
export function MonthlyOrderSummaryCard({
  currentMonth,
  confirmedOrder,
  confidenceAForecast,
  confidenceBForecast,
}: MonthlyOrderSummaryCardProps) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium text-[var(--text-secondary)]">月別受注サマリー</h3>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
        <div className="flex-1">
          <StatCard
            title={`${currentMonth}月の受注（確定分）`}
            sales={confirmedOrder?.sales ?? null}
            grossProfit={confirmedOrder?.grossProfit ?? null}
            targetGrossProfit={confirmedOrder?.targetGrossProfit ?? 0}
            achievementRate={confirmedOrder?.achievementRate ?? null}
          />
        </div>
        <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-stretch">
          <ConfidenceForecastStat title={`${currentMonth}月の受注（確度A）`} forecast={confidenceAForecast} />
          <ConfidenceForecastStat title={`${currentMonth}月の受注（確度B）`} forecast={confidenceBForecast} />
        </div>
      </div>
    </div>
  );
}
