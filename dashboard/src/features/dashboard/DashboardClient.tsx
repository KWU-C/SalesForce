"use client";

import { useMemo, useState } from "react";
import { CrTabs } from "@/components/CrTabs";
import { StatCard } from "@/components/StatCard";
import { MonthlyTable } from "@/components/MonthlyTable";
import { MonthlyCumulativeTable } from "@/components/MonthlyCumulativeTable";
import { CrossCrProgressTable } from "@/components/CrossCrProgressTable";
import { PeriodSummarySection } from "@/components/PeriodSummarySection";
import { PeriodComparisonChart } from "./charts/PeriodComparisonChart";
import { summarizePeriod } from "@/features/sales-progress/aggregate";
import { FULL_YEAR, HALVES, QUARTERS } from "@/config/fiscalPeriods";
import type { CrId, CrProgress } from "@/domain/types";

interface DashboardClientProps {
  progressByCr: CrProgress[];
  currentMonth: number;
}

export function DashboardClient({
  progressByCr,
  currentMonth,
}: DashboardClientProps) {
  const [selectedCr, setSelectedCr] = useState<CrId>("ALL");

  const current = useMemo(
    () => progressByCr.find((p) => p.crId === selectedCr)!,
    [progressByCr, selectedCr]
  );

  const orderYearSummary = summarizePeriod(
    FULL_YEAR.label,
    FULL_YEAR.months,
    current.order
  );
  const completedYearSummary = summarizePeriod(
    FULL_YEAR.label,
    FULL_YEAR.months,
    current.completed
  );

  const orderQuarterSummaries = QUARTERS.map((q) =>
    summarizePeriod(q.label, q.months, current.order)
  );
  const orderHalfSummaries = HALVES.map((h) =>
    summarizePeriod(h.label, h.months, current.order)
  );

  const completedQuarterSummaries = QUARTERS.map((q) =>
    summarizePeriod(q.label, q.months, current.completed)
  );
  const completedHalfSummaries = HALVES.map((h) =>
    summarizePeriod(h.label, h.months, current.completed)
  );

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6">
      <CrTabs selected={selectedCr} onSelect={setSelectedCr} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <StatCard
          title="受注（当月時点累計）"
          sales={orderYearSummary.sales}
          grossProfit={orderYearSummary.grossProfit}
          targetGrossProfit={orderYearSummary.targetGrossProfit}
          achievementRate={orderYearSummary.achievementRate}
        />
        <StatCard
          title="完了（当月時点累計）"
          sales={completedYearSummary.sales}
          grossProfit={completedYearSummary.grossProfit}
          targetGrossProfit={completedYearSummary.targetGrossProfit}
          achievementRate={completedYearSummary.achievementRate}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <PeriodComparisonChart
          title="月別受注：前期／今期"
          current={current.order}
          previous={current.previousOrder}
          currentColorVar="--series-1"
        />
        <PeriodComparisonChart
          title="月別完了：前期／今期"
          current={current.completed}
          previous={current.previousCompleted}
          currentColorVar="--series-2"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <MonthlyCumulativeTable title="受注" data={current.order} />
        <MonthlyCumulativeTable title="完了" data={current.completed} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <MonthlyTable title="受注" data={current.order} />
        <MonthlyTable title="完了" data={current.completed} />
      </div>

      <div className="flex flex-col gap-4">
        <PeriodSummarySection title="受注：四半期累計" summaries={orderQuarterSummaries} />
        <PeriodSummarySection title="受注：上半期・下半期累計" summaries={orderHalfSummaries} />
        <PeriodSummarySection
          title="完了：四半期累計"
          summaries={completedQuarterSummaries}
        />
        <PeriodSummarySection
          title="完了：上半期・下半期累計"
          summaries={completedHalfSummaries}
        />
      </div>

      <CrossCrProgressTable progressByCr={progressByCr} currentMonth={currentMonth} />

      <p className="pb-2 text-center text-xs text-[var(--text-muted)]">
        表示中: {currentMonth}月時点までの実績（モックデータ）
      </p>
    </div>
  );
}
