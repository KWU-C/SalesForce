import { afterEach, describe, expect, it, vi } from "vitest";
import type { LoanStatus } from "./loanStatus";

const getLoanStatusSnapshotMock = vi.fn();
const saveLoanStatusSnapshotMock = vi.fn();
const getLoanStatusMock = vi.fn();

vi.mock("@/repositories/loanStatusSnapshotRepository", () => ({
  getLoanStatusSnapshot: getLoanStatusSnapshotMock,
  saveLoanStatusSnapshot: saveLoanStatusSnapshotMock,
}));
vi.mock("./loanStatus", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./loanStatus")>();
  return { ...actual, getLoanStatus: getLoanStatusMock };
});

const { getOrFetchLoanStatus } = await import("./loanStatusService");

function makeLoanStatus(overrides: Partial<LoanStatus> = {}): LoanStatus {
  return {
    lines: [],
    totalOpening: 100,
    totalCurrent: 80,
    totalNewBorrowing: 0,
    totalRepayment: 20,
    netChange: -20,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  getLoanStatusSnapshotMock.mockReset();
  saveLoanStatusSnapshotMock.mockReset();
  getLoanStatusMock.mockReset();
});

describe("getOrFetchLoanStatus", () => {
  it("returns the cached snapshot without calling freee when one exists", async () => {
    const cached = { fiscalYear: 2025, month: 8, ...makeLoanStatus(), fetchedAt: new Date("2026-09-14T00:00:00Z") };
    getLoanStatusSnapshotMock.mockResolvedValue(cached);

    const result = await getOrFetchLoanStatus(2025, 8);

    expect(result).toEqual(cached);
    expect(getLoanStatusMock).not.toHaveBeenCalled();
  });

  it("computes from freee and backfills Firestore when there is no cache", async () => {
    getLoanStatusSnapshotMock.mockResolvedValue(null);
    getLoanStatusMock.mockResolvedValue(makeLoanStatus({ totalCurrent: 999 }));

    const result = await getOrFetchLoanStatus(2025, 8);

    expect(getLoanStatusMock).toHaveBeenCalledWith(2025, 8);
    expect(saveLoanStatusSnapshotMock).toHaveBeenCalledWith(
      expect.objectContaining({ fiscalYear: 2025, month: 8, totalCurrent: 999 })
    );
    expect(result?.totalCurrent).toBe(999);
  });

  it("returns null when freee is not connected, never fabricating a snapshot", async () => {
    getLoanStatusSnapshotMock.mockResolvedValue(null);
    getLoanStatusMock.mockResolvedValue(null);

    const result = await getOrFetchLoanStatus(2025, 8);

    expect(result).toBeNull();
    expect(saveLoanStatusSnapshotMock).not.toHaveBeenCalled();
  });

  it("forceRefresh always recomputes even when a cache entry exists", async () => {
    getLoanStatusMock.mockResolvedValue(makeLoanStatus({ totalCurrent: 555 }));

    const result = await getOrFetchLoanStatus(2025, 8, { forceRefresh: true });

    expect(getLoanStatusSnapshotMock).not.toHaveBeenCalled();
    expect(result?.totalCurrent).toBe(555);
  });
});
