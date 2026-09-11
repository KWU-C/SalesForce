"use client";

import { useMemo, useState } from "react";
import { StatCard } from "@/components/StatCard";
import { FISCAL_MONTH_ORDER, fiscalMonthIndex } from "@/config/fiscalPeriods";
import type { MonthlyProgress } from "@/domain/types";

interface MonthlyOrderSummaryCardProps {
  /** 当該CRの月別受注データ(12ヶ月分、未到来月はnull) */
  monthlyOrders: MonthlyProgress[];
  /** 当月（暦月）。プルダウンの初期選択値であり、選べる範囲の上限でもある */
  currentMonth: number;
}

/**
 * 当月の受注額・目標額・達成率をStatCardで表示し、プルダウンで当月から過去の月へ
 * 遡れるようにする（ユーザー確定）。未到来月は選択肢に含めない。
 */
export function MonthlyOrderSummaryCard({ monthlyOrders, currentMonth }: MonthlyOrderSummaryCardProps) {
  const selectableMonths = useMemo(() => {
    const currentIndex = fiscalMonthIndex(currentMonth);
    return FISCAL_MONTH_ORDER.slice(0, currentIndex).reverse();
  }, [currentMonth]);

  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const selected = monthlyOrders.find((m) => m.month === selectedMonth) ?? null;

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
      <StatCard
        title={`${selectedMonth}月の受注`}
        sales={selected?.sales ?? null}
        grossProfit={selected?.grossProfit ?? null}
        targetGrossProfit={selected?.targetGrossProfit ?? 0}
        achievementRate={selected?.achievementRate ?? null}
      />
    </div>
  );
}
