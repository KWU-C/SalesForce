import { listCashPlans, listMonthlyReports } from "@/repositories/accountingReportRepository";
import { getMonthlyPlSnapshot } from "@/repositories/monthlyPlSnapshotRepository";
import { sortByTargetMonthDesc, targetMonthPeriod } from "./accountingReports";
import type { CashPlan, FreeeCumulative, MonthlyReport } from "./accountingReports";

export interface MonthlyReportWithFreee {
  report: MonthlyReport;
  /** 比較できるfreeeの値が無ければnull(その月の月次P/Lが未取得、または累計項目の追加前の取得分) */
  freee: FreeeCumulative | null;
}

export interface AccountingReportsView {
  monthlyReports: MonthlyReportWithFreee[];
  cashPlans: CashPlan[];
}

/**
 * 経理月次報告・資金繰り予定セクションの表示データ。freeeの比較値は、既存の月次P/L
 * スナップショット(monthlyPlSnapshots、定時更新・「更新」ボタンで取得済みのもの)から読むだけで、
 * freee APIは呼ばない(ユーザー確定、2026-10-15)。
 */
export async function getAccountingReportsView(): Promise<AccountingReportsView> {
  const [reports, cashPlans] = await Promise.all([listMonthlyReports(), listCashPlans()]);
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
  return { monthlyReports, cashPlans: sortByTargetMonthDesc(cashPlans) };
}
