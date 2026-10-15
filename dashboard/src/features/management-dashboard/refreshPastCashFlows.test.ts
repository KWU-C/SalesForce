import { afterEach, describe, expect, it, vi } from "vitest";

const getFreeeCompanyIdMock = vi.fn();
const saveMonthlyCashFlowSnapshotMock = vi.fn();
const getJournalsCsvMock = vi.fn();
const computeMonthlyCashFlowMock = vi.fn();
const getOrComputeTermCashFlowTotalMock = vi.fn();

vi.mock("@/repositories/freeeAuthRepository", () => ({ getFreeeCompanyId: getFreeeCompanyIdMock }));
vi.mock("@/repositories/monthlyCashFlowSnapshotRepository", () => ({
  saveMonthlyCashFlowSnapshot: saveMonthlyCashFlowSnapshotMock,
}));
vi.mock("@/services/freee/freeeJournalsClient", () => ({ getJournalsCsv: getJournalsCsvMock }));
vi.mock("./journalCsv", () => ({
  journalExportRange: (fy: number) => ({ start: `${fy - 1}-09-01`, end: `${fy + 1}-08-31` }),
  parseJournalCsv: () => [{ date: "2026-09-01" }],
}));
vi.mock("./monthlyCashFlow", () => ({ computeMonthlyCashFlow: computeMonthlyCashFlowMock }));
vi.mock("./termCashFlowTotalService", () => ({ getOrComputeTermCashFlowTotal: getOrComputeTermCashFlowTotalMock }));

const { refreshPastCashFlows } = await import("./refreshPastCashFlows");

afterEach(() => {
  vi.resetAllMocks();
});

describe("refreshPastCashFlows", () => {
  it("does nothing when freee is not connected", async () => {
    getFreeeCompanyIdMock.mockResolvedValue(null);
    const result = await refreshPastCashFlows(50, 12);
    expect(result).toEqual({ connected: false, refreshedMonths: [], refreshedPreviousTerm: null });
    expect(getJournalsCsvMock).not.toHaveBeenCalled();
  });

  it("recomputes every past month of the current term from a single journal export, saving only after all succeed", async () => {
    getFreeeCompanyIdMock.mockResolvedValue(1);
    getJournalsCsvMock.mockResolvedValue("csv");
    computeMonthlyCashFlowMock.mockImplementation(async (_c: number, _fy: number, month: number) => ({ cashClosing: month }));

    const result = await refreshPastCashFlows(50, 1); // 1月: 期首(9月)〜12月が過去月

    expect(getJournalsCsvMock).toHaveBeenCalledTimes(1);
    expect(getJournalsCsvMock).toHaveBeenCalledWith(1, "2025-09-01", "2027-08-31");
    expect(computeMonthlyCashFlowMock.mock.calls.map((c) => c[2])).toEqual([9, 10, 11, 12]);
    expect(computeMonthlyCashFlowMock.mock.calls[0][3]).toEqual({ journalGroups: [{ date: "2026-09-01" }] });
    expect(saveMonthlyCashFlowSnapshotMock.mock.calls.map((c) => c[0].month)).toEqual([9, 10, 11, 12]);
    expect(saveMonthlyCashFlowSnapshotMock.mock.calls[0][0]).toMatchObject({ fiscalYear: 2026, month: 9, cashClosing: 9 });
    // 1月は期首から5か月目なので前期は取り直さない
    expect(getOrComputeTermCashFlowTotalMock).not.toHaveBeenCalled();
    expect(result).toEqual({ connected: true, refreshedMonths: [9, 10, 11, 12], refreshedPreviousTerm: null });
  });

  it("saves nothing when one month fails", async () => {
    getFreeeCompanyIdMock.mockResolvedValue(1);
    getJournalsCsvMock.mockResolvedValue("csv");
    computeMonthlyCashFlowMock.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("freee_api_error"));

    await expect(refreshPastCashFlows(50, 11)).rejects.toThrow("freee_api_error");
    expect(saveMonthlyCashFlowSnapshotMock).not.toHaveBeenCalled();
  });

  it("in the first months of a term, also recomputes the previous term (12 months + term total together)", async () => {
    getFreeeCompanyIdMock.mockResolvedValue(1);
    getOrComputeTermCashFlowTotalMock.mockResolvedValue({ term: 49 });

    const september = await refreshPastCashFlows(50, 9);
    expect(getJournalsCsvMock).not.toHaveBeenCalled(); // 9月は当期の過去月が無い
    expect(getOrComputeTermCashFlowTotalMock).toHaveBeenCalledWith(49, { forceRefresh: true });
    expect(september).toEqual({ connected: true, refreshedMonths: [], refreshedPreviousTerm: 49 });

    getJournalsCsvMock.mockResolvedValue("csv");
    computeMonthlyCashFlowMock.mockResolvedValue({});
    getOrComputeTermCashFlowTotalMock.mockClear();
    await refreshPastCashFlows(50, 11);
    expect(getOrComputeTermCashFlowTotalMock).toHaveBeenCalledTimes(1);

    getOrComputeTermCashFlowTotalMock.mockClear();
    await refreshPastCashFlows(50, 12);
    expect(getOrComputeTermCashFlowTotalMock).not.toHaveBeenCalled();
  });
});
