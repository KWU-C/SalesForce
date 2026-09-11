"use client";

import { useMemo, useState } from "react";
import { StatCard } from "@/components/StatCard";
import { FISCAL_MONTH_ORDER, fiscalMonthIndex } from "@/config/fiscalPeriods";
import type { MonthlyProgress } from "@/domain/types";
import { formatThousandYen } from "@/utils/format";

interface MonthlyOrderSummaryCardProps {
  /** 当該CRの月別受注データ(12ヶ月分、未到来月はnull) */
  monthlyOrders: MonthlyProgress[];
  /** 当月（暦月）。プルダウンの初期選択値であり、選べる範囲の上限でもある */
  currentMonth: number;
  /** 受注確度A(80〜100%)のパイプライン粗利合計（案件一覧の粗利合計行と同じ値）。対象なしはnull */
  confidenceAGrossProfit: number | null;
}

function ConfidenceAStat({ grossProfit }: { grossProfit: number | null }) {
  return (
    <div className="shrink-0 rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)] p-4">
      <p className="text-sm text-[var(--text-secondary)]">A (80～100%)</p>
      <p className="mt-1 text-2xl font-semibold text-[var(--text-primary)]">
        {grossProfit === null ? "—" : formatThousandYen(grossProfit)}
      </p>
      <p className="text-xs text-[var(--text-muted)]">粗利</p>
    </div>
  );
}

/**
 * 当月の受注額・目標額・達成率をStatCardで表示し、プルダウンで当月から過去の月へ
 * 遡れるようにする（ユーザー確定）。未到来月は選択肢に含めない。
 * 右側に受注確度A(パイプライン一覧の粗利合計)を並べて表示する（ユーザー確定）。
 */
export function MonthlyOrderSummaryCard({
  monthlyOrders,
  currentMonth,
  confidenceAGrossProfit,
}: MonthlyOrderSummaryCardProps) {
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="flex-1">
          <StatCard
            title={`${selectedMonth}月の受注`}
            sales={selected?.sales ?? null}
            grossProfit={selected?.grossProfit ?? null}
            targetGrossProfit={selected?.targetGrossProfit ?? 0}
            achievementRate={selected?.achievementRate ?? null}
          />
        </div>
        <ConfidenceAStat grossProfit={confidenceAGrossProfit} />
      </div>
    </div>
  );
}
