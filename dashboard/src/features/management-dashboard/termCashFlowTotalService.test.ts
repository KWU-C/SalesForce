import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExpenseCategory } from "@/config/freeeExpenseClassification";
import type { TermCashFlowTotal } from "./termCashFlowTotal";

const getTermCashFlowSnapshotMock = vi.fn();
const saveTermCashFlowSnapshotMock = vi.fn();
const getFreeeCompanyIdMock = vi.fn();
const computeTermCashFlowMock = vi.fn();
const saveMonthlyCashFlowSnapshotMock = vi.fn();

vi.mock("@/repositories/termCashFlowSnapshotRepository", () => ({
  getTermCashFlowSnapshot: getTermCashFlowSnapshotMock,
  saveTermCashFlowSnapshot: saveTermCashFlowSnapshotMock,
}));
vi.mock("@/repositories/freeeAuthRepository", () => ({
  getFreeeCompanyId: getFreeeCompanyIdMock,
}));
vi.mock("@/repositories/monthlyCashFlowSnapshotRepository", () => ({
  saveMonthlyCashFlowSnapshot: saveMonthlyCashFlowSnapshotMock,
}));
vi.mock("./termCashFlowTotal", () => ({
  computeTermCashFlow: computeTermCashFlowMock,
}));

const { getOrComputeTermCashFlowTotal } = await import("./termCashFlowTotalService");

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

function makeComputed(overrides: Partial<Omit<TermCashFlowTotal, "computedAt">> = {}) {
  return {
    term: 49,
    fiscalYear: 2025,
    cashOpening: 1_000_000,
    cashClosing: 2_000_000,
    cashChange: 1_000_000,
    externalIncome: 5_000_000,
    externalExpenseTotal: 4_000_000,
    expenseByCategory: EMPTY_CATEGORIES,
    operatingCashFlow: 1_000_000,
    financingCashFlow: -100_000,
    interestCashFlow: -10_000,
    assetTransferCashFlow: -20_000,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  getTermCashFlowSnapshotMock.mockReset();
  saveTermCashFlowSnapshotMock.mockReset();
  getFreeeCompanyIdMock.mockReset();
  computeTermCashFlowMock.mockReset();
  saveMonthlyCashFlowSnapshotMock.mockReset();
});

describe("getOrComputeTermCashFlowTotal", () => {
  it("returns the cached snapshot without touching freee when one already exists", async () => {
    const cached = { ...makeComputed(), computedAt: new Date("2026-09-01T00:00:00Z") };
    getTermCashFlowSnapshotMock.mockResolvedValue(cached);

    const result = await getOrComputeTermCashFlowTotal(49);

    expect(result).toEqual(cached);
    expect(getFreeeCompanyIdMock).not.toHaveBeenCalled();
    expect(computeTermCashFlowMock).not.toHaveBeenCalled();
    expect(saveTermCashFlowSnapshotMock).not.toHaveBeenCalled();
  });

  it("computes from freee and saves permanently when there is no cache yet (one-time backfill)", async () => {
    getTermCashFlowSnapshotMock.mockResolvedValue(null);
    getFreeeCompanyIdMock.mockResolvedValue(123);
    computeTermCashFlowMock.mockResolvedValue({ total: makeComputed({ term: 49 }), months: [] });

    const result = await getOrComputeTermCashFlowTotal(49);

    expect(computeTermCashFlowMock).toHaveBeenCalledWith(123, 49);
    expect(saveTermCashFlowSnapshotMock).toHaveBeenCalledWith(
      expect.objectContaining({ term: 49, fiscalYear: 2025 })
    );
    expect(result?.term).toBe(49);
  });

  it("returns null without saving anything when freee is not connected", async () => {
    getTermCashFlowSnapshotMock.mockResolvedValue(null);
    getFreeeCompanyIdMock.mockResolvedValue(null);

    const result = await getOrComputeTermCashFlowTotal(49);

    expect(result).toBeNull();
    expect(computeTermCashFlowMock).not.toHaveBeenCalled();
    expect(saveTermCashFlowSnapshotMock).not.toHaveBeenCalled();
  });

  it("without forceRefresh, a cached term is never recomputed (page access / daily job path)", async () => {
    const cached = { ...makeComputed(), computedAt: new Date("2026-09-01T00:00:00Z") };
    getTermCashFlowSnapshotMock.mockResolvedValue(cached);

    await getOrComputeTermCashFlowTotal(49);

    expect(computeTermCashFlowMock).not.toHaveBeenCalled();
  });

  it("with forceRefresh:true, recomputes and overwrites even when a cache entry exists (manual 更新 button path)", async () => {
    getTermCashFlowSnapshotMock.mockResolvedValue({ ...makeComputed(), computedAt: new Date("2026-09-01T00:00:00Z") });
    getFreeeCompanyIdMock.mockResolvedValue(123);
    computeTermCashFlowMock.mockResolvedValue({ total: makeComputed({ term: 49, cashClosing: 9_999_999 }), months: [] });

    const result = await getOrComputeTermCashFlowTotal(49, { forceRefresh: true });

    expect(getTermCashFlowSnapshotMock).not.toHaveBeenCalled();
    expect(computeTermCashFlowMock).toHaveBeenCalledWith(123, 49);
    expect(saveTermCashFlowSnapshotMock).toHaveBeenCalledWith(
      expect.objectContaining({ term: 49, cashClosing: 9_999_999 })
    );
    expect(result?.cashClosing).toBe(9_999_999);
  });

  it("also saves the 12 computed months as monthly snapshots, so displayed months and the term total always agree (入金側v3)", async () => {
    getTermCashFlowSnapshotMock.mockResolvedValue(null);
    getFreeeCompanyIdMock.mockResolvedValue(123);
    const monthValues = { cashOpening: 1, cashClosing: 2 } as never;
    computeTermCashFlowMock.mockResolvedValue({
      total: makeComputed({ term: 49 }),
      months: [
        { month: 9, values: monthValues },
        { month: 10, values: monthValues },
      ],
    });

    await getOrComputeTermCashFlowTotal(49);

    expect(saveMonthlyCashFlowSnapshotMock).toHaveBeenCalledTimes(2);
    expect(saveMonthlyCashFlowSnapshotMock).toHaveBeenCalledWith(
      expect.objectContaining({ fiscalYear: 2025, month: 9, cashOpening: 1 })
    );
    expect(saveMonthlyCashFlowSnapshotMock).toHaveBeenCalledWith(
      expect.objectContaining({ fiscalYear: 2025, month: 10 })
    );
  });
});
