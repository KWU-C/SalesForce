import { afterEach, describe, expect, it, vi } from "vitest";

const getOrFetchMonthlyCashFlowMock = vi.fn();
const getOrFetchLoanStatusMock = vi.fn();
const getOrFetchFundReserveCoreMock = vi.fn();
const getOrFetchFinancialSummaryMock = vi.fn();

vi.mock("./monthlyCashFlowService", () => ({ getOrFetchMonthlyCashFlow: getOrFetchMonthlyCashFlowMock }));
vi.mock("./loanStatusService", () => ({ getOrFetchLoanStatus: getOrFetchLoanStatusMock }));
vi.mock("./fundReserveService", () => ({ getOrFetchFundReserveCore: getOrFetchFundReserveCoreMock }));
vi.mock("./financialSummaryService", () => ({ getOrFetchFinancialSummary: getOrFetchFinancialSummaryMock }));

const { refreshCurrentMonthSnapshots } = await import("./refreshCurrentMonthSnapshots");

function mockAllSucceed() {
  getOrFetchMonthlyCashFlowMock.mockResolvedValue({ fiscalYear: 2025, month: 8 });
  getOrFetchLoanStatusMock.mockResolvedValue({ fiscalYear: 2025, month: 8 });
  getOrFetchFundReserveCoreMock.mockResolvedValue({ fiscalYear: 2025, month: 8 });
  getOrFetchFinancialSummaryMock.mockResolvedValue({ fiscalYear: 2025, month: 8 });
}

afterEach(() => {
  vi.restoreAllMocks();
  getOrFetchMonthlyCashFlowMock.mockReset();
  getOrFetchLoanStatusMock.mockReset();
  getOrFetchFundReserveCoreMock.mockReset();
  getOrFetchFinancialSummaryMock.mockReset();
});

describe("refreshCurrentMonthSnapshots", () => {
  it("force-refreshes the three core snapshots and skips financialSummary by default", async () => {
    mockAllSucceed();

    const result = await refreshCurrentMonthSnapshots(2025, 8);

    expect(getOrFetchMonthlyCashFlowMock).toHaveBeenCalledWith(2025, 8, { forceRefresh: true });
    expect(getOrFetchLoanStatusMock).toHaveBeenCalledWith(2025, 8, { forceRefresh: true });
    expect(getOrFetchFundReserveCoreMock).toHaveBeenCalledWith(2025, 8, { forceRefresh: true });
    expect(getOrFetchFinancialSummaryMock).not.toHaveBeenCalled();
    expect(result).toEqual({ connected: true });
  });

  it("also force-refreshes financialSummary when includeFinancialSummary is true", async () => {
    mockAllSucceed();

    const result = await refreshCurrentMonthSnapshots(2025, 9, { includeFinancialSummary: true });

    expect(getOrFetchFinancialSummaryMock).toHaveBeenCalledWith(2025, 9, { forceRefresh: true });
    expect(result).toEqual({ connected: true });
  });

  it("reports connected:false when any of the three core snapshots is null (freee not connected)", async () => {
    mockAllSucceed();
    getOrFetchLoanStatusMock.mockResolvedValue(null);

    const result = await refreshCurrentMonthSnapshots(2025, 8);

    expect(result).toEqual({ connected: false });
  });

  it("reports connected:false when includeFinancialSummary is true and financialSummary is null, even if the other three succeed", async () => {
    mockAllSucceed();
    getOrFetchFinancialSummaryMock.mockResolvedValue(null);

    const result = await refreshCurrentMonthSnapshots(2025, 9, { includeFinancialSummary: true });

    expect(result).toEqual({ connected: false });
  });

  it("ignores a null financialSummary when includeFinancialSummary is not requested", async () => {
    mockAllSucceed();
    getOrFetchFinancialSummaryMock.mockResolvedValue(null);

    const result = await refreshCurrentMonthSnapshots(2025, 8);

    expect(result).toEqual({ connected: true });
  });

  it("propagates a rejection from any underlying fetch instead of swallowing it", async () => {
    mockAllSucceed();
    getOrFetchMonthlyCashFlowMock.mockRejectedValue(new Error("freee_api_error"));

    await expect(refreshCurrentMonthSnapshots(2025, 8)).rejects.toThrow("freee_api_error");
  });
});
