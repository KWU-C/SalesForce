import { listCashPlans, listMonthlyReports } from "@/repositories/accountingReportRepository";
import { getMonthlyPlSnapshot } from "@/repositories/monthlyPlSnapshotRepository";
import { getMonthlyCashFlowSnapshot } from "@/repositories/monthlyCashFlowSnapshotRepository";
import { monthEndBoundary, resolveCashPlanActual, sortByTargetMonthDesc, targetMonthPeriod } from "./accountingReports";
import type { CashPlan, CashPlanActual, FreeeCumulative, MonthlyReport } from "./accountingReports";

export interface MonthlyReportWithFreee {
  report: MonthlyReport;
  /** 比較できるfreeeの値が無ければnull(その月の月次P/Lが未取得、または累計項目の追加前の取得分) */
  freee: FreeeCumulative | null;
}

export interface CashPlanWithActual {
  plan: CashPlan;
  /** freeeの月末実績(月次資金収支スナップショットの種類別月末残高) */
  actual: CashPlanActual;
}

export interface AccountingReportsView {
  monthlyReports: MonthlyReportWithFreee[];
  cashPlans: CashPlanWithActual[];
}

/**
 * 経理月次報告・資金繰り予定セクションの表示データ。freeeの値は既存のスナップショット
 * (月次P/L=monthlyPlSnapshots、月末残高=monthlyCashFlowSnapshots。定時更新・「更新」ボタンで
 * 取得済みのもの)から読むだけで、freee APIは呼ばない(ユーザー確定、2026-10-15・2026-10-21)。
 * 経理の登録値は読むだけで、freeeの値で書き換えない。
 */
export async function getAccountingReportsView(now: Date = new Date()): Promise<AccountingReportsView> {
  const [reports, plans] = await Promise.all([listMonthlyReports(), listCashPlans()]);
  const monthlyReports = await Promise.all(
    sortByTargetMonthDesc(reports).map(async (report) => {
      const { fiscalYear, month } = targetMonthPeriod(report.targetMonth);
      const snapshot = await getMonthlyPlSnapshot(fiscalYear, month);
      const hasCumulative =
        snapshot !== null && (snapshot.revenueCumulative !== undefined || snapshot.ordinaryProfitCumulative !== undefined);
      return {
        report,
        freee: hasCumulative
          ? {
              revenueCumulative: snapshot.revenueCumulative ?? null,
              ordinaryProfitCumulative: snapshot.ordinaryProfitCumulative ?? null,
              fetchedAt: snapshot.fetchedAt.toISOString(),
            }
          : null,
      };
    })
  );
  const cashPlans = await Promise.all(
    sortByTargetMonthDesc(plans).map(async (plan) => {
      const { fiscalYear, month } = targetMonthPeriod(plan.targetMonth);
      // 月末前の対象月はスナップショットを読まない(月末残高ではないため)
      const snapshot = now < monthEndBoundary(plan.targetMonth) ? null : await getMonthlyCashFlowSnapshot(fiscalYear, month);
      return { plan, actual: resolveCashPlanActual(plan.targetMonth, snapshot, now) };
    })
  );
  return { monthlyReports, cashPlans };
}
