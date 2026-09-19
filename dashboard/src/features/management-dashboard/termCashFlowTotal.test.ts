import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_INFLOW } from "./cashInflow";
import { EMPTY_OUTFLOW } from "./cashOutflow";
import { FISCAL_MONTH_ORDER } from "@/config/fiscalPeriods";
import type { ExpenseCategory } from "@/config/freeeExpenseClassification";
import type { MonthlyCashFlow } from "./types";

const computeMonthlyCashFlowMock = vi.fn();
const getJournalsCsvMock = vi.fn();

vi.mock("./monthlyCashFlow", () => ({
  computeMonthlyCashFlow: computeMonthlyCashFlowMock,
}));
vi.mock("@/services/freee/freeeJournalsClient", () => ({
  getJournalsCsv: getJournalsCsvMock,
}));

const { computeTermCashFlowTotal, computeTermCashFlow } = await import("./termCashFlowTotal");

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
    calculationVersion: "test-version",
    status: "final",
    expenseByCategory: { ...EMPTY_CATEGORIES, labor: 300_000, outsourcing: 100_000 },
    operatingCashFlow: 100_000,
    financingCashFlow: -50_000,
    interestCashFlow: -5_000,
    assetTransferCashFlow: -10_000,
    ...overrides,
  };
}

beforeEach(() => {
  getJournalsCsvMock.mockResolvedValue("");
});

afterEach(() => {
  computeMonthlyCashFlowMock.mockReset();
  getJournalsCsvMock.mockReset();
});

describe("computeTermCashFlowTotal", () => {
  it("calls computeMonthlyCashFlow once per fiscal month (12 times) in FISCAL_MONTH_ORDER, reusing the existing monthly computation", async () => {
    computeMonthlyCashFlowMock.mockResolvedValue(makeMonth());

    await computeTermCashFlowTotal(999, 49);

    expect(computeMonthlyCashFlowMock).toHaveBeenCalledTimes(12);
    for (const month of FISCAL_MONTH_ORDER) {
      expect(computeMonthlyCashFlowMock).toHaveBeenCalledWith(999, 2025, month, { journalGroups: [] });
    }
  });

  it("exports the journals only once (前期の期首〜期末、債務の原因科目を辿る根拠を含む) and shares them with all 12 monthly computations", async () => {
    computeMonthlyCashFlowMock.mockResolvedValue(makeMonth());

    await computeTermCashFlowTotal(999, 49);

    expect(getJournalsCsvMock).toHaveBeenCalledTimes(1);
    expect(getJournalsCsvMock).toHaveBeenCalledWith(999, "2024-09-01", "2026-08-31");
  });

  it("term inflow is exactly the sum of the 12 monthly inflows (通期専用の別計算なし)", async () => {
    computeMonthlyCashFlowMock.mockImplementation(async (_c: number, _fy: number, month: number) => {
      const operating = month * 1_000;
      const inflow = { ...EMPTY_INFLOW, operating, total: operating + 10, other: 10 };
      return makeMonth({ inflow, externalIncome: inflow.total });
    });

    const result = await computeTermCashFlowTotal(1, 49);
    const expectedOperating = FISCAL_MONTH_ORDER.reduce((s, m) => s + m * 1_000, 0);

    expect(result.inflow?.operating).toBe(expectedOperating);
    expect(result.inflow?.total).toBe(expectedOperating + 120);
    expect(result.externalIncome).toBe(result.inflow?.total);
  });

  it("returns the 12 monthly results (FISCAL_MONTH_ORDER) alongside the total so they can be saved as monthly snapshots", async () => {
    computeMonthlyCashFlowMock.mockResolvedValue(makeMonth());

    const { months } = await computeTermCashFlow(1, 49);

    expect(months.map((m) => m.month)).toEqual(FISCAL_MONTH_ORDER);
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

  it("marks the term provisional when any single month is provisional (証拠付き補完・除外の適用または未分類あり)", async () => {
    computeMonthlyCashFlowMock.mockImplementation(async (_companyId: number, _fiscalYear: number, month: number) =>
      makeMonth(month === 10 ? { status: "provisional" } : {})
    );

    const result = await computeTermCashFlowTotal(1, 49);

    expect(result.status).toBe("provisional");
  });

  it("term outflow is exactly the sum of the 12 monthly outflows, and the term operating cash flow is the sum of the months", async () => {
    computeMonthlyCashFlowMock.mockImplementation(async (_c: number, _fy: number, month: number) => {
      const labor = month * 100;
      const outflow = { ...EMPTY_OUTFLOW, labor, unclassified: 3, total: labor + 3 };
      return makeMonth({ outflow, externalExpenseTotal: outflow.total, operatingCashFlow: month });
    });

    const result = await computeTermCashFlowTotal(1, 49);
    const expectedLabor = FISCAL_MONTH_ORDER.reduce((s, m) => s + m * 100, 0);

    expect(result.outflow?.labor).toBe(expectedLabor);
    expect(result.outflow?.unclassified).toBe(36);
    expect(result.outflow?.total).toBe(expectedLabor + 36);
    expect(result.externalExpenseTotal).toBe(result.outflow?.total);
    expect(result.operatingCashFlow).toBe(FISCAL_MONTH_ORDER.reduce((s, m) => s + m, 0));
  });

  it("stays final when every month is clean", async () => {
    computeMonthlyCashFlowMock.mockResolvedValue(makeMonth());

    const result = await computeTermCashFlowTotal(1, 50);

    expect(result.status).toBe("final");
  });
});
