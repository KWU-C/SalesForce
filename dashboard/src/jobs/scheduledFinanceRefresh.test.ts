import { afterEach, describe, expect, it, vi } from "vitest";

const refreshCurrentMonthSnapshotsMock = vi.fn();
const refreshPastCashFlowsMock = vi.fn();
const getCurrentFiscalPeriodMock = vi.fn();
const freeeFiscalYearForTermMock = vi.fn();

vi.mock("../features/management-dashboard/refreshCurrentMonthSnapshots", () => ({
  refreshCurrentMonthSnapshots: refreshCurrentMonthSnapshotsMock,
}));
vi.mock("../features/management-dashboard/refreshPastCashFlows", () => ({
  refreshPastCashFlows: refreshPastCashFlowsMock,
}));
vi.mock("../config/fiscalPeriods", () => ({
  getCurrentFiscalPeriod: getCurrentFiscalPeriodMock,
  freeeFiscalYearForTerm: freeeFiscalYearForTermMock,
}));

const { runScheduledFinanceRefresh } = await import("./scheduledFinanceRefresh");

afterEach(() => {
  vi.restoreAllMocks();
  refreshCurrentMonthSnapshotsMock.mockReset();
  refreshPastCashFlowsMock.mockReset();
  getCurrentFiscalPeriodMock.mockReset();
  freeeFiscalYearForTermMock.mockReset();
});

describe("runScheduledFinanceRefresh", () => {
  it("computes the current fiscal year/month server-side and force-refreshes with financial summary included", async () => {
    getCurrentFiscalPeriodMock.mockReturnValue({ term: 49, currentMonth: 9 });
    freeeFiscalYearForTermMock.mockReturnValue(2025);
    refreshCurrentMonthSnapshotsMock.mockResolvedValue({ connected: true });
    refreshPastCashFlowsMock.mockResolvedValue({ connected: true, refreshedMonths: [], refreshedPreviousTerm: 48 });

    const result = await runScheduledFinanceRefresh();

    expect(refreshCurrentMonthSnapshotsMock).toHaveBeenCalledWith(2025, 9, { includeFinancialSummary: true });
    expect(refreshPastCashFlowsMock).toHaveBeenCalledWith(49, 9);
    expect(result).toEqual({
      fiscalYear: 2025,
      month: 9,
      connected: true,
      refreshedPastMonths: [],
      refreshedPreviousTerm: 48,
    });
  });

  it("refreshes past months only after the current month has been saved, and skips them when freee is not connected", async () => {
    getCurrentFiscalPeriodMock.mockReturnValue({ term: 50, currentMonth: 10 });
    freeeFiscalYearForTermMock.mockReturnValue(2026);
    const order: string[] = [];
    refreshCurrentMonthSnapshotsMock.mockImplementation(async () => {
      order.push("current");
      return { connected: true };
    });
    refreshPastCashFlowsMock.mockImplementation(async () => {
      order.push("past");
      return { connected: true, refreshedMonths: [9], refreshedPreviousTerm: 49 };
    });

    const result = await runScheduledFinanceRefresh();
    expect(order).toEqual(["current", "past"]);
    expect(result.refreshedPastMonths).toEqual([9]);

    refreshCurrentMonthSnapshotsMock.mockResolvedValue({ connected: false });
    refreshPastCashFlowsMock.mockClear();
    await runScheduledFinanceRefresh();
    expect(refreshPastCashFlowsMock).not.toHaveBeenCalled();
  });

  it("propagates a past-month refresh failure (the current month was already saved)", async () => {
    getCurrentFiscalPeriodMock.mockReturnValue({ term: 50, currentMonth: 10 });
    freeeFiscalYearForTermMock.mockReturnValue(2026);
    refreshCurrentMonthSnapshotsMock.mockResolvedValue({ connected: true });
    refreshPastCashFlowsMock.mockRejectedValue(new Error("freee_journals_timeout"));

    await expect(runScheduledFinanceRefresh()).rejects.toThrow("freee_journals_timeout");
    expect(refreshCurrentMonthSnapshotsMock).toHaveBeenCalled();
  });

  it("reports connected:false as data (not a thrown error) when freee is not connected", async () => {
    getCurrentFiscalPeriodMock.mockReturnValue({ term: 49, currentMonth: 9 });
    freeeFiscalYearForTermMock.mockReturnValue(2025);
    refreshCurrentMonthSnapshotsMock.mockResolvedValue({ connected: false });

    const result = await runScheduledFinanceRefresh();

    expect(result.connected).toBe(false);
  });

  it("propagates a rejection instead of swallowing it (caller/process boundary decides the exit code)", async () => {
    getCurrentFiscalPeriodMock.mockReturnValue({ term: 49, currentMonth: 9 });
    freeeFiscalYearForTermMock.mockReturnValue(2025);
    refreshCurrentMonthSnapshotsMock.mockRejectedValue(new Error("freee_api_error"));

    await expect(runScheduledFinanceRefresh()).rejects.toThrow("freee_api_error");
  });
});
