import { describe, expect, it } from "vitest";
import { sumMonthlyCashFlows } from "./cashFlowCumulative";
import { EMPTY_OUTFLOW } from "./cashOutflow";
import type { MonthlyCashFlow } from "./types";

// 金額はすべて架空
const month = (m: number, opening: number, closing: number, income: number, expense: number): MonthlyCashFlow =>
  ({
    fiscalYear: 2026,
    month: m,
    cashOpening: opening,
    cashClosing: closing,
    cashChange: closing - opening,
    checkingSavingsClosing: closing - 10,
    timeDepositClosing: 10,
    cashOnHandClosing: 0,
    externalIncome: income,
    externalExpenseTotal: expense,
    outflow: { ...EMPTY_OUTFLOW, total: expense, labor: expense },
    calculationVersion: "v",
    status: "final",
    expenseByCategory: { labor: expense, outsourcing: 0, taxSocial: 0, otherOperating: 0, other: 0, financing: 0, interest: 0, assetTransfer: 0 },
    operatingCashFlow: income - expense,
    financingCashFlow: 0,
    interestCashFlow: 0,
    assetTransferCashFlow: 0,
    fetchedAt: new Date("2026-11-16T08:00:00Z"),
  }) as MonthlyCashFlow;

describe("入出金明細の当期累計", () => {
  it("流れは月の合計、残高は月末値(月初=最初の月の月初、月末=最後の月の月末)で、月ごとの残高は足さない", () => {
    const r = sumMonthlyCashFlows([month(9, 1_000, 1_200, 500, 300), month(10, 1_200, 1_100, 200, 300), month(11, 1_100, 900, 100, 300)])!;
    expect(r.cashOpening).toBe(1_000);
    expect(r.cashClosing).toBe(900);
    expect(r.cashChange).toBe(-100);
    expect(r.externalIncome).toBe(800);
    expect(r.externalExpenseTotal).toBe(900);
    expect(r.outflow?.labor).toBe(900);
    expect(r.externalIncome - r.externalExpenseTotal).toBe(r.cashChange);
  });

  it("月が欠けていれば出さない(一部の月だけの合計にしない)", () => {
    expect(sumMonthlyCashFlows([month(9, 1, 2, 1, 0), null])).toBeNull();
  });
});
