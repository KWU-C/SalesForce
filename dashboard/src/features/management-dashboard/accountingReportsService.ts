import { listCashPlans, listMonthlyReports } from "@/repositories/accountingReportRepository";
import { getMonthlyCashFlowSnapshot } from "@/repositories/monthlyCashFlowSnapshotRepository";
import { monthEndBoundary, resolveCashPlanActual, sortByTargetMonthDesc, targetMonthPeriod } from "./accountingReports";
import type { CashPlan, CashPlanActual, MonthlyReport } from "./accountingReports";

export interface CashPlanWithActual {
  plan: CashPlan;
  /** freeeの月末実績(月次資金収支スナップショットの種類別月末残高) */
  actual: CashPlanActual;
}

export interface AccountingReportsView {
  cashPlans: CashPlanWithActual[];
  /** 経理月次報告(登録値のまま)。概要の一番上「経理報告」に使う */
  monthlyReports: MonthlyReport[];
}

/**
 * 資金繰り見通しセクションの表示データ。登録済みの資金繰り予定(cashPlanForecasts)と、freeeの月末実績
 * (既存の月次資金収支スナップショット、定時更新・「更新」ボタンで取得済みのもの)を読むだけで、
 * freee APIは呼ばず、登録値も書き換えない(ユーザー確定、2026-10-21)。
 * 経理月次報告(accountingMonthlyReports)は2026-10-21にいったん画面から外したが、2026-11-16に概要の一番上で
 * 経理報告PDFを再現するため、登録値をそのまま読むようにした(freeeの値で置き換えない)。
 */
export async function getAccountingReportsView(now: Date = new Date()): Promise<AccountingReportsView> {
  const [plans, monthlyReports] = await Promise.all([listCashPlans(), listMonthlyReports()]);
  const cashPlans = await Promise.all(
    sortByTargetMonthDesc(plans).map(async (plan) => {
      const { fiscalYear, month } = targetMonthPeriod(plan.targetMonth);
      // 月末前の対象月はスナップショットを読まない(月末残高ではないため)
      const snapshot = now < monthEndBoundary(plan.targetMonth) ? null : await getMonthlyCashFlowSnapshot(fiscalYear, month);
      return { plan, actual: resolveCashPlanActual(plan.targetMonth, snapshot, now) };
    })
  );
  return { cashPlans, monthlyReports };
}
