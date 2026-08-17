import { FISCAL_MONTH_ORDER } from "@/config/fiscalPeriods";
import type { CrId, MonthlyProgress, ProgressKind } from "@/domain/types";

type ConcreteCrId = Exclude<CrId, "ALL">;

/** SOQL集計クエリ（buildOrderProgressQuery/buildCompletedProgressQuery）の1行 */
export interface ProgressAggregateRow {
  crId: string;
  mo: number;
  sales: number | null;
  grossProfit: number | null;
}

/** 事業期の年間目標（SalesTarget__c 1レコード分） */
export interface AnnualSalesTarget {
  targetSales: number;
  targetGrossProfit: number;
}

/**
 * SOQL集計結果を、対象CR・月ごとのMonthlyProgressへ変換する。
 * 集計行に存在しない月は「未入力」としてnullにする（実績なし＝未到来 or
 * その月に条件を満たす案件がなかった、のいずれか。GoogleSheets実装と同じ方針）。
 *
 * 目標値は年間目標をCR数(3)・月数(12)で均等按分する（ユーザー確定、2026-08-07）。
 */
export function mapAggregateRowsToMonthlyProgress(
  rows: ProgressAggregateRow[],
  crId: ConcreteCrId,
  kind: ProgressKind,
  perCrAnnualTarget: AnnualSalesTarget
): MonthlyProgress[] {
  const targetGrossProfit = perCrAnnualTarget.targetGrossProfit / 12;
  const targetSales = perCrAnnualTarget.targetSales / 12;

  return FISCAL_MONTH_ORDER.map((month) => {
    const row = rows.find((r) => r.crId === crId && r.mo === month);
    const sales = row ? row.sales : null;
    const grossProfit = row ? row.grossProfit : null;
    const achievementRate =
      grossProfit === null
        ? null
        : targetGrossProfit === 0
          ? 0
          : Math.round((grossProfit / targetGrossProfit) * 1000) / 10;

    return {
      crId,
      kind,
      month,
      sales,
      grossProfit,
      targetGrossProfit,
      targetSales,
      achievementRate,
    };
  });
}
