import { afterEach, describe, expect, it, vi } from "vitest";
import type { FinancialSummary } from "./financialSummary";

const getFinancialSummarySnapshotMock = vi.fn();
const saveFinancialSummarySnapshotMock = vi.fn();
const getFinancialSummaryMock = vi.fn();

vi.mock("@/repositories/financialSummarySnapshotRepository", () => ({
  getFinancialSummarySnapshot: getFinancialSummarySnapshotMock,
  saveFinancialSummarySnapshot: saveFinancialSummarySnapshotMock,
}));
vi.mock("./financialSummary", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./financialSummary")>();
  return { ...actual, getFinancialSummary: getFinancialSummaryMock };
});

const { getOrFetchFinancialSummary } = await import("./financialSummaryService");

function makeFinancialSummary(overrides: Partial<FinancialSummary> = {}): FinancialSummary {
  return {
    revenue: 1000,
    grossProfit: 600,
    grossProfitRate: 60,
    operatingProfit: 200,
    operatingProfitRate: 20,
    ordinaryProfit: 210,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  getFinancialSummarySnapshotMock.mockReset();
  saveFinancialSummarySnapshotMock.mockReset();
  getFinancialSummaryMock.mockReset();
});

describe("getOrFetchFinancialSummary", () => {
  it("returns the cached snapshot without calling freee when one exists", async () => {
    const cached = { fiscalYear: 2025, month: 8, ...makeFinancialSummary(), fetchedAt: new Date("2026-09-14T00:00:00Z") };
    getFinancialSummarySnapshotMock.mockResolvedValue(cached);

    const result = await getOrFetchFinancialSummary(2025, 8);

    expect(result).toEqual(cached);
    expect(getFinancialSummaryMock).not.toHaveBeenCalled();
  });

  it("computes from freee and backfills Firestore when there is no cache", async () => {
    getFinancialSummarySnapshotMock.mockResolvedValue(null);
    getFinancialSummaryMock.mockResolvedValue(makeFinancialSummary({ revenue: 999 }));

    const result = await getOrFetchFinancialSummary(2025, 8);

    expect(getFinancialSummaryMock).toHaveBeenCalledWith(2025);
    expect(saveFinancialSummarySnapshotMock).toHaveBeenCalledWith(
      expect.objectContaining({ fiscalYear: 2025, month: 8, revenue: 999 })
    );
    expect(result?.revenue).toBe(999);
  });

  it("returns null when freee is not connected, never fabricating a snapshot", async () => {
    getFinancialSummarySnapshotMock.mockResolvedValue(null);
    getFinancialSummaryMock.mockResolvedValue(null);

    const result = await getOrFetchFinancialSummary(2025, 8);

    expect(result).toBeNull();
    expect(saveFinancialSummarySnapshotMock).not.toHaveBeenCalled();
  });

  it("forceRefresh always recomputes even when a cache entry exists", async () => {
    getFinancialSummaryMock.mockResolvedValue(makeFinancialSummary({ revenue: 555 }));

    const result = await getOrFetchFinancialSummary(2025, 8, { forceRefresh: true });

    expect(getFinancialSummarySnapshotMock).not.toHaveBeenCalled();
    expect(result?.revenue).toBe(555);
  });
});
