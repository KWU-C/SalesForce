import { afterEach, describe, expect, it, vi } from "vitest";

const refreshCurrentMonthSnapshotsMock = vi.fn();
const getCurrentFiscalPeriodMock = vi.fn();
const freeeFiscalYearForTermMock = vi.fn();

vi.mock("../features/management-dashboard/refreshCurrentMonthSnapshots", () => ({
  refreshCurrentMonthSnapshots: refreshCurrentMonthSnapshotsMock,
}));
vi.mock("../config/fiscalPeriods", () => ({
  getCurrentFiscalPeriod: getCurrentFiscalPeriodMock,
  freeeFiscalYearForTerm: freeeFiscalYearForTermMock,
}));

const { runScheduledFinanceRefresh } = await import("./scheduledFinanceRefresh");

afterEach(() => {
  vi.restoreAllMocks();
  refreshCurrentMonthSnapshotsMock.mockReset();
  getCurrentFiscalPeriodMock.mockReset();
  freeeFiscalYearForTermMock.mockReset();
});

describe("runScheduledFinanceRefresh", () => {
  it("computes the current fiscal year/month server-side and force-refreshes with financial summary included", async () => {
    getCurrentFiscalPeriodMock.mockReturnValue({ term: 49, currentMonth: 9 });
    freeeFiscalYearForTermMock.mockReturnValue(2025);
    refreshCurrentMonthSnapshotsMock.mockResolvedValue({ connected: true });

    const result = await runScheduledFinanceRefresh();

    expect(refreshCurrentMonthSnapshotsMock).toHaveBeenCalledWith(2025, 9, { includeFinancialSummary: true });
    expect(result).toEqual({ fiscalYear: 2025, month: 9, connected: true });
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
