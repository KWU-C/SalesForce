"use client";

import { useMemo, useState } from "react";
import { CrTabs } from "@/components/CrTabs";
import { StatCard } from "@/components/StatCard";
import { MonthlyTable } from "@/components/MonthlyTable";
import { MonthlyCumulativeTable } from "@/components/MonthlyCumulativeTable";
import { CrossCrProgressTable } from "@/components/CrossCrProgressTable";
import { ClientRankingTable } from "@/components/ClientRankingTable";
import { LeaderRankingTable } from "@/components/LeaderRankingTable";
import { PeriodSummarySection } from "@/components/PeriodSummarySection";
import { CategoryPieChart } from "@/components/CategoryPieChart";
import { PeriodComparisonChart } from "./charts/PeriodComparisonChart";
import { summarizePeriod } from "@/features/sales-progress/aggregate";
import { buildCategorySlices } from "@/features/sales-progress/categoryChart";
import { FULL_YEAR, HALVES, QUARTERS } from "@/config/fiscalPeriods";
import { getCrListForTerm } from "@/domain/types";
import type { CrId, CrProgress } from "@/domain/types";
import { formatTime } from "@/utils/format";

interface DashboardClientProps {
  progressByCr: CrProgress[];
  currentMonth: number;
  term: number;
  /** データ取得時刻。ヘッダーと同じ値を使い、フッターにも取得元・取得日時を表示する */
  fetchedAt: Date;
  /** "Salesforce"/"モックデータ"等、取得元を示す短いラベル */
  dataSourceLabel: string;
}

export function DashboardClient({
  progressByCr,
  currentMonth,
  term,
  fetchedAt,
  dataSourceLabel,
}: DashboardClientProps) {
  const [selectedCr, setSelectedCr] = useState<CrId>("ALL");
  const crList = useMemo(() => getCrListForTerm(term), [term]);
  // CR一覧は事業期によって変わる(48・49期はCR1〜3、50期以降はCR1〜4、
  // ユーザー確定2026-09-01)。CR4選択中に48/49期へ切り替えるなど、選択中のCRが
  // 新しい期に存在しない場合は表示上は全社(ALL)へフォールバックする
  // (existingのselectedCr自体は変更しない。存在しないcrIdでfindするとクラッシュするため)
  const effectiveCr = crList.some((cr) => cr.id === selectedCr) ? selectedCr : "ALL";

  const current = useMemo(
    () => progressByCr.find((p) => p.crId === effectiveCr) ?? progressByCr[0],
    [progressByCr, effectiveCr]
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
      <CrTabs crList={crList} selected={effectiveCr} onSelect={setSelectedCr} />

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

      <CrossCrProgressTable progressByCr={progressByCr} currentMonth={currentMonth} term={term} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ClientRankingTable
          title="受注額（粗利）トップ20クライアント"
          clients={current.topOrderClients}
          accentColorVar="--series-1"
        />
        <ClientRankingTable
          title="完了額（粗利）トップ20クライアント"
          clients={current.topCompletedClients}
          accentColorVar="--series-2"
        />
      </div>

      <hr className="mt-[76px] border-t-2 border-[var(--baseline)]" />

      {effectiveCr === "ALL" ? (
        <>
          <div>
            <h3 className="mb-4 text-sm font-medium text-[var(--text-secondary)]">
              区分別（受注）
            </h3>
            <CategoryPieChart
              title="全社"
              slices={buildCategorySlices(current.orderByCategory, current.orderByCategory)}
            />
            <div className="mt-4 flex flex-wrap justify-center gap-6">
              {crList
                .filter((cr) => cr.id !== "ALL")
                .map((cr) => {
                  const crProgress = progressByCr.find((p) => p.crId === cr.id);
                  if (!crProgress) return null;
                  return (
                    <CategoryPieChart
                      key={cr.id}
                      title={cr.label}
                      slices={buildCategorySlices(current.orderByCategory, crProgress.orderByCategory)}
                      compact
                    />
                  );
                })}
            </div>
          </div>

          <hr className="border-t-2 border-[var(--baseline)]" />

          <div>
            <h3 className="mb-2 text-sm font-medium text-[var(--text-secondary)]">
              全社月別詳細
            </h3>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <MonthlyTable title="受注" data={current.order} />
              <MonthlyTable title="完了" data={current.completed} />
            </div>
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
        </>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <LeaderRankingTable
            title="受注（粗利）リーダー別"
            leaders={current.topOrderLeaders}
            accentColorVar="--series-1"
          />
          <LeaderRankingTable
            title="完了（粗利）リーダー別"
            leaders={current.topCompletedLeaders}
            accentColorVar="--series-2"
          />
        </div>
      )}

      <p className="pb-2 text-center text-xs text-[var(--text-muted)]">
        表示中: {currentMonth}月時点までの実績（{dataSourceLabel}、取得日時 {formatTime(fetchedAt)}）
      </p>
    </div>
  );
}
