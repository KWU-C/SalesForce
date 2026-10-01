"use client";

import { useMemo, useState } from "react";
import { StatCard } from "@/components/StatCard";
import { FISCAL_MONTH_ORDER, fiscalMonthIndex } from "@/config/fiscalPeriods";
import type { MonthlyProgress } from "@/domain/types";
import type { ConfidenceAForecast } from "@/features/sales-progress/pipelineGrouping";
import { formatYen } from "@/utils/format";

interface MonthlyOrderSummaryCardProps {
  /** 当該CRの月別受注データ(12ヶ月分、未到来月はnull) */
  monthlyOrders: MonthlyProgress[];
  /** 当月（暦月）。プルダウンの初期選択値であり、選べる範囲の上限でもある */
  currentMonth: number;
  /**
   * 受注確度A(80〜100%)の未確定案件(提案・見積)を受注予定月ごとに合算したもの。
   * 「◯月の受注」(受注確定分)には含まれない、その月の受注予測分。該当案件の無い月はキー無し
   */
  confidenceAForecastByMonth: Map<number, ConfidenceAForecast>;
}

function ConfidenceAStat({
  grossProfit,
  sales,
}: {
  grossProfit: number | null;
  sales: number | null;
}) {
  return (
    <div className="flex-1 rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)] p-4">
      <p className="text-sm text-[var(--text-secondary)]">その他、受注確度A (80～100%)</p>
      <p className="mt-1 text-2xl font-semibold text-[var(--text-primary)]">
        {grossProfit === null ? "—" : formatYen(grossProfit)}
      </p>
      <p className="text-xs text-[var(--text-muted)]">粗利</p>
      {/* StatCardの目標粗利・達成率の行と天地を揃えるための不可視スペーサー(内容は同じ高さのダミー) */}
      <div className="invisible mt-2 flex items-center justify-between text-sm" aria-hidden="true">
        <span>目標粗利 —</span>
        <span className="font-medium">粗利達成率 —</span>
      </div>
      <div className="mt-3 border-t border-[var(--gridline)] pt-2 text-left">
        <p className="text-lg font-medium text-[var(--text-primary)]">
          {sales === null ? "—" : formatYen(sales)}
        </p>
        <p className="text-xs text-[var(--text-muted)]">売上</p>
      </div>
    </div>
  );
}

/**
 * 当月の受注額・目標額・達成率をStatCardで表示し、プルダウンで当月から過去の月へ
 * 遡れるようにする（ユーザー確定）。未到来月は選択肢に含めない。
 * 右側に、選択月の受注予測に入っているが未確定(提案・見積)の受注確度A分を並べて表示する
 * （左の受注確定分とは重複しない。ユーザー確定、2026-10-01）。
 */
export function MonthlyOrderSummaryCard({
  monthlyOrders,
  currentMonth,
  confidenceAForecastByMonth,
}: MonthlyOrderSummaryCardProps) {
  const selectableMonths = useMemo(() => {
    const currentIndex = fiscalMonthIndex(currentMonth);
    return FISCAL_MONTH_ORDER.slice(0, currentIndex).reverse();
  }, [currentMonth]);

  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const selected = monthlyOrders.find((m) => m.month === selectedMonth) ?? null;
  const confidenceAForecast = confidenceAForecastByMonth.get(selectedMonth) ?? null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-[var(--text-secondary)]">月別受注サマリー</h3>
        <select
          aria-label="対象月を選択"
          value={selectedMonth}
          onChange={(e) => setSelectedMonth(Number(e.target.value))}
          className="rounded border border-[var(--border-hairline)] bg-[var(--surface-1)] px-2 py-1 text-sm font-medium text-[var(--text-primary)]"
        >
          {selectableMonths.map((month) => (
            <option key={month} value={month}>
              {month}月
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
        <div className="flex-1">
          <StatCard
            title={`${selectedMonth}月の受注`}
            sales={selected?.sales ?? null}
            grossProfit={selected?.grossProfit ?? null}
            targetGrossProfit={selected?.targetGrossProfit ?? 0}
            achievementRate={selected?.achievementRate ?? null}
          />
        </div>
        <ConfidenceAStat
          grossProfit={confidenceAForecast?.grossProfit ?? null}
          sales={confidenceAForecast?.sales ?? null}
        />
      </div>
    </div>
  );
}
