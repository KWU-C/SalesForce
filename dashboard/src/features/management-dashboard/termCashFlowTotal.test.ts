import { describe, expect, it, vi } from "vitest";
import { FISCAL_MONTH_ORDER } from "@/config/fiscalPeriods";
import type { ExpenseCategory } from "@/config/freeeExpenseClassification";
import type { MonthlyCashFlow } from "./types";

const computeMonthlyCashFlowMock = vi.fn();

vi.mock("./monthlyCashFlow", () => ({
  computeMonthlyCashFlow: computeMonthlyCashFlowMock,
}));

const { computeTermCashFlowTotal } = await import("./termCashFlowTotal");

const EMPTY_CATEGORIES: Record<ExpenseCategory, number> = {
  labor: 0,
  outsourcing: 0,
  taxSocial: 0,
  financing: 0,
  interest: 0,
  assetTransfer: 0,
  otherOperating: 0,
  other: 0,
};

type MonthResult = Omit<MonthlyCashFlow, "fiscalYear" | "month" | "fetchedAt">;

function makeMonth(overrides: Partial<MonthResult> = {}): MonthResult {
  return {
    cashOpening: 1_000_000,
    cashClosing: 1_100_000,
    cashChange: 100_000,
    externalIncome: 500_000,
    externalExpenseTotal: 400_000,
    expenseByCategory: { ...EMPTY_CATEGORIES, labor: 300_000, outsourcing: 100_000 },
    operatingCashFlow: 100_000,
    financingCashFlow: -50_000,
    interestCashFlow: -5_000,
    assetTransferCashFlow: -10_000,
    ...overrides,
  };
}

describe("computeTermCashFlowTotal", () => {
  it("calls computeMonthlyCashFlow once per fiscal month (12 times) in FISCAL_MONTH_ORDER, reusing the existing monthly computation", async () => {
    computeMonthlyCashFlowMock.mockResolvedValue(makeMonth());

    await computeTermCashFlowTotal(999, 49);

    expect(computeMonthlyCashFlowMock).toHaveBeenCalledTimes(12);
    for (const month of FISCAL_MONTH_ORDER) {
      expect(computeMonthlyCashFlowMock).toHaveBeenCalledWith(999, 2025, month);
    }
  });

  it("uses the first month's cashOpening (9月) and the last month's cashClosing (8月) for the term total", async () => {
    computeMonthlyCashFlowMock.mockImplementation(async (_companyId: number, _fiscalYear: number, month: number) =>
      makeMonth({ cashOpening: month === 9 ? 5_000_000 : 0, cashClosing: month === 8 ? 8_000_000 : 0 })
    );

    const result = await computeTermCashFlowTotal(1, 49);

    expect(result.cashOpening).toBe(5_000_000);
    expect(result.cashClosing).toBe(8_000_000);
    expect(result.cashChange).toBe(3_000_000);
  });

  it("sums flow fields (externalIncome, expenseByCategory, operatingCashFlow, etc.) across all 12 months", async () => {
    computeMonthlyCashFlowMock.mockResolvedValue(
      makeMonth({ externalIncome: 100_000, operatingCashFlow: 10_000, financingCashFlow: -1_000 })
    );

    const result = await computeTermCashFlowTotal(1, 49);

    expect(result.externalIncome).toBe(100_000 * 12);
    expect(result.operatingCashFlow).toBe(10_000 * 12);
    expect(result.financingCashFlow).toBe(-1_000 * 12);
    expect(result.expenseByCategory.labor).toBe(300_000 * 12);
    expect(result.expenseByCategory.outsourcing).toBe(100_000 * 12);
  });

  it("returns null cashChange when either endpoint is null (未取得), not a fabricated number", async () => {
    computeMonthlyCashFlowMock.mockImplementation(async (_companyId: number, _fiscalYear: number, month: number) =>
      makeMonth({ cashOpening: month === 9 ? null : 0, cashClosing: 8_000_000 })
    );

    const result = await computeTermCashFlowTotal(1, 49);

    expect(result.cashOpening).toBeNull();
    expect(result.cashChange).toBeNull();
  });

  it("works generically for a different term without any term-specific branching", async () => {
    computeMonthlyCashFlowMock.mockResolvedValue(makeMonth());

    const result = await computeTermCashFlowTotal(1, 50);

    expect(result.term).toBe(50);
    expect(result.fiscalYear).toBe(2026);
  });
});
