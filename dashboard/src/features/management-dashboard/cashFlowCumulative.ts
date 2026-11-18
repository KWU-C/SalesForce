import type { ExpenseCategory } from "@/config/freeeExpenseClassification";
import { sumInflows } from "./cashInflow";
import type { CashInflowBreakdown } from "./cashInflow";
import { sumOutflows } from "./cashOutflow";
import type { CashOutflowBreakdown } from "./cashOutflow";
import type { MonthlyCashFlow } from "./types";

/**
 * 入出金明細の当期累計の列(2026-11-18、ユーザー指定)。収入・支出などの流れは月ごとの値を合計し、
 * 残高は月末値を使う(月初=最初の月の月初、月末=最後の月の月末。月ごとの残高は足さない)。
 * 月が1つでも欠けていれば null(一部の月だけの合計を出さない)。
 */
export function sumMonthlyCashFlows(months: (MonthlyCashFlow | null)[]): MonthlyCashFlow | null {
  if (months.length === 0 || months.some((m) => m === null)) return null;
  const ms = months as MonthlyCashFlow[];
  const first = ms[0];
  const last = ms[ms.length - 1];
  const sum = (get: (m: MonthlyCashFlow) => number) => ms.reduce((t, m) => t + get(m), 0);
  const expenseByCategory = { ...first.expenseByCategory };
  for (const c of Object.keys(expenseByCategory) as ExpenseCategory[]) expenseByCategory[c] = sum((m) => m.expenseByCategory[c] ?? 0);
  const inflows = ms.map((m) => m.inflow).filter((x): x is CashInflowBreakdown => x !== undefined);
  const outflows = ms.map((m) => m.outflow).filter((x): x is CashOutflowBreakdown => x !== undefined);
  return {
    ...last,
    fiscalYear: last.fiscalYear,
    month: last.month,
    cashOpening: first.cashOpening,
    cashClosing: last.cashClosing,
    cashChange: first.cashOpening !== null && last.cashClosing !== null ? last.cashClosing - first.cashOpening : null,
    checkingSavingsClosing: last.checkingSavingsClosing,
    timeDepositClosing: last.timeDepositClosing,
    cashOnHandClosing: last.cashOnHandClosing,
    externalIncome: sum((m) => m.externalIncome),
    inflow: inflows.length === ms.length ? sumInflows(inflows) : undefined,
    externalExpenseTotal: sum((m) => m.externalExpenseTotal),
    outflow: outflows.length === ms.length ? sumOutflows(outflows) : undefined,
    calculationVersion: ms.every((m) => m.calculationVersion === first.calculationVersion) ? first.calculationVersion : "mixed",
    status: ms.some((m) => m.status === "provisional") ? "provisional" : "final",
    expenseByCategory,
    operatingCashFlow: sum((m) => m.operatingCashFlow),
    financingCashFlow: sum((m) => m.financingCashFlow),
    interestCashFlow: sum((m) => m.interestCashFlow),
    assetTransferCashFlow: sum((m) => m.assetTransferCashFlow),
    fetchedAt: last.fetchedAt,
  };
}
