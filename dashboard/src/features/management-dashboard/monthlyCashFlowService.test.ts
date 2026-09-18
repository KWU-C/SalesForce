import { afterEach, describe, expect, it, vi } from "vitest";
import type { MonthlyCashFlow } from "./types";

const getMonthlyCashFlowSnapshotMock = vi.fn();
const saveMonthlyCashFlowSnapshotMock = vi.fn();
const getFreeeCompanyIdMock = vi.fn();
const computeMonthlyCashFlowMock = vi.fn();

vi.mock("@/repositories/monthlyCashFlowSnapshotRepository", () => ({
  getMonthlyCashFlowSnapshot: getMonthlyCashFlowSnapshotMock,
  saveMonthlyCashFlowSnapshot: saveMonthlyCashFlowSnapshotMock,
}));
vi.mock("@/repositories/freeeAuthRepository", () => ({
  getFreeeCompanyId: getFreeeCompanyIdMock,
}));
vi.mock("./monthlyCashFlow", () => ({
  computeMonthlyCashFlow: computeMonthlyCashFlowMock,
}));

const { getOrFetchMonthlyCashFlow } = await import("./monthlyCashFlowService");

function makeSnapshot(): MonthlyCashFlow {
  return {
    fiscalYear: 2025,
    month: 8,
    cashOpening: 1000,
    cashClosing: 1200,
    cashChange: 200,
    externalIncome: 500,
    externalExpenseTotal: 300,
    calculationVersion: "test-version",
    status: "final",
    appliedOverrideIds: [],
    unresolvedItems: [],
    tentativeCandidates: [],
    expenseByCategory: { labor: 0, outsourcing: 0, taxSocial: 0, financing: 0, interest: 0, assetTransfer: 0, otherOperating: 0, other: 0 },
    operatingCashFlow: 200,
    financingCashFlow: 0,
    interestCashFlow: 0,
    assetTransferCashFlow: 0,
    fetchedAt: new Date("2026-09-14T00:00:00Z"),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  getMonthlyCashFlowSnapshotMock.mockReset();
  saveMonthlyCashFlowSnapshotMock.mockReset();
  getFreeeCompanyIdMock.mockReset();
  computeMonthlyCashFlowMock.mockReset();
});

describe("getOrFetchMonthlyCashFlow", () => {
  it("returns the cached snapshot without calling freee when one exists", async () => {
    const cached = makeSnapshot();
    getMonthlyCashFlowSnapshotMock.mockResolvedValue(cached);

    const result = await getOrFetchMonthlyCashFlow(2025, 8);

    expect(result).toEqual(cached);
    expect(getFreeeCompanyIdMock).not.toHaveBeenCalled();
    expect(computeMonthlyCashFlowMock).not.toHaveBeenCalled();
  });

  it("computes from freee and backfills Firestore when there is no cache", async () => {
    getMonthlyCashFlowSnapshotMock.mockResolvedValue(null);
    getFreeeCompanyIdMock.mockResolvedValue(11314786);
    computeMonthlyCashFlowMock.mockResolvedValue({
      cashOpening: 1,
      cashClosing: 2,
      cashChange: 1,
      externalIncome: 3,
      externalExpenseTotal: 4,
      expenseByCategory: { labor: 0, outsourcing: 0, taxSocial: 0, financing: 0, interest: 0, assetTransfer: 0, otherOperating: 0, other: 0 },
      operatingCashFlow: 0,
      financingCashFlow: 0,
      interestCashFlow: 0,
      assetTransferCashFlow: 0,
    });

    const result = await getOrFetchMonthlyCashFlow(2025, 8);

    expect(computeMonthlyCashFlowMock).toHaveBeenCalledWith(11314786, 2025, 8);
    expect(saveMonthlyCashFlowSnapshotMock).toHaveBeenCalledWith(
      expect.objectContaining({ fiscalYear: 2025, month: 8, externalIncome: 3 })
    );
    expect(result?.externalIncome).toBe(3);
  });

  it("returns null when freee is not connected, never fabricating a snapshot", async () => {
    getMonthlyCashFlowSnapshotMock.mockResolvedValue(null);
    getFreeeCompanyIdMock.mockResolvedValue(null);

    const result = await getOrFetchMonthlyCashFlow(2025, 8);

    expect(result).toBeNull();
    expect(computeMonthlyCashFlowMock).not.toHaveBeenCalled();
  });

  it("forceRefresh always recomputes even when a cache entry exists", async () => {
    getFreeeCompanyIdMock.mockResolvedValue(11314786);
    computeMonthlyCashFlowMock.mockResolvedValue({
      cashOpening: 1,
      cashClosing: 2,
      cashChange: 1,
      externalIncome: 999,
      externalExpenseTotal: 4,
      expenseByCategory: { labor: 0, outsourcing: 0, taxSocial: 0, financing: 0, interest: 0, assetTransfer: 0, otherOperating: 0, other: 0 },
      operatingCashFlow: 0,
      financingCashFlow: 0,
      interestCashFlow: 0,
      assetTransferCashFlow: 0,
    });

    const result = await getOrFetchMonthlyCashFlow(2025, 8, { forceRefresh: true });

    expect(getMonthlyCashFlowSnapshotMock).not.toHaveBeenCalled();
    expect(result?.externalIncome).toBe(999);
  });
});
