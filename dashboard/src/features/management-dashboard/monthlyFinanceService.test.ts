import { afterEach, describe, expect, it, vi } from "vitest";
import type { MonthlyFinanceSnapshot } from "./types";

const getMonthlyFinanceSnapshotMock = vi.fn();
const saveMonthlyFinanceSnapshotMock = vi.fn();
const getFreeeCompanyIdMock = vi.fn();
const fetchMonthlyFinanceFromFreeeMock = vi.fn();
const getCurrentFiscalPeriodMock = vi.fn();

vi.mock("@/repositories/monthlyFinanceSnapshotRepository", () => ({
  getMonthlyFinanceSnapshot: getMonthlyFinanceSnapshotMock,
  saveMonthlyFinanceSnapshot: saveMonthlyFinanceSnapshotMock,
}));
vi.mock("@/repositories/freeeAuthRepository", () => ({
  getFreeeCompanyId: getFreeeCompanyIdMock,
}));
vi.mock("./monthlyFinanceSnapshot", () => ({
  fetchMonthlyFinanceFromFreee: fetchMonthlyFinanceFromFreeeMock,
}));
vi.mock("@/config/fiscalPeriods", async () => {
  const actual = await vi.importActual<typeof import("@/config/fiscalPeriods")>("@/config/fiscalPeriods");
  return { ...actual, getCurrentFiscalPeriod: getCurrentFiscalPeriodMock };
});

const { getOrFetchMonthlyFinance, getFiscalYearTrend } = await import("./monthlyFinanceService");

function makeSnapshot(overrides: Partial<MonthlyFinanceSnapshot> = {}): MonthlyFinanceSnapshot {
  return {
    fiscalYear: 2025,
    month: 9,
    sales: 100,
    grossProfit: 60,
    grossMargin: 60,
    laborCost: 20,
    outsourcingCost: 10,
    otherSga: 5,
    operatingProfit: 25,
    operatingMargin: 25,
    ordinaryProfit: 26,
    cashOpening: 1000,
    cashClosing: 1050,
    cashChange: 50,
    accountsReceivable: 500,
    accountsPayable: 300,
    unpaidExpenses: 50,
    borrowings: 500,
    fetchedAt: new Date("2026-09-14T00:00:00Z"),
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  getMonthlyFinanceSnapshotMock.mockReset();
  saveMonthlyFinanceSnapshotMock.mockReset();
  getFreeeCompanyIdMock.mockReset();
  fetchMonthlyFinanceFromFreeeMock.mockReset();
  getCurrentFiscalPeriodMock.mockReset();
});

describe("getOrFetchMonthlyFinance", () => {
  it("returns the cached Firestore snapshot without calling freee when one exists", async () => {
    const cached = makeSnapshot();
    getMonthlyFinanceSnapshotMock.mockResolvedValue(cached);

    const result = await getOrFetchMonthlyFinance(2025, 9);

    expect(result).toEqual(cached);
    expect(getFreeeCompanyIdMock).not.toHaveBeenCalled();
    expect(fetchMonthlyFinanceFromFreeeMock).not.toHaveBeenCalled();
  });

  it("fetches from freee and backfills Firestore when there is no cache", async () => {
    getMonthlyFinanceSnapshotMock.mockResolvedValue(null);
    getFreeeCompanyIdMock.mockResolvedValue(11314786);
    fetchMonthlyFinanceFromFreeeMock.mockResolvedValue({ sales: 100 });

    const result = await getOrFetchMonthlyFinance(2025, 9);

    expect(fetchMonthlyFinanceFromFreeeMock).toHaveBeenCalledWith(11314786, 2025, 9);
    expect(saveMonthlyFinanceSnapshotMock).toHaveBeenCalledWith(
      expect.objectContaining({ fiscalYear: 2025, month: 9, sales: 100 })
    );
    expect(result?.sales).toBe(100);
  });

  it("returns null when freee is not connected (no company id), never fabricating a snapshot", async () => {
    getMonthlyFinanceSnapshotMock.mockResolvedValue(null);
    getFreeeCompanyIdMock.mockResolvedValue(null);

    const result = await getOrFetchMonthlyFinance(2025, 9);

    expect(result).toBeNull();
    expect(fetchMonthlyFinanceFromFreeeMock).not.toHaveBeenCalled();
  });

  it("forceRefresh always re-fetches from freee even when a cache entry exists", async () => {
    getFreeeCompanyIdMock.mockResolvedValue(11314786);
    fetchMonthlyFinanceFromFreeeMock.mockResolvedValue({ sales: 200 });

    const result = await getOrFetchMonthlyFinance(2025, 9, { forceRefresh: true });

    expect(getMonthlyFinanceSnapshotMock).not.toHaveBeenCalled();
    expect(result?.sales).toBe(200);
  });
});

describe("getFiscalYearTrend", () => {
  it("skips months that haven't occurred yet (never fabricates future data)", async () => {
    // 現在は50期・11月時点という想定。9,10,11月のみ対象になるはず
    getCurrentFiscalPeriodMock.mockReturnValue({ term: 50, currentMonth: 11 });
    getMonthlyFinanceSnapshotMock.mockResolvedValue(makeSnapshot());
    getFreeeCompanyIdMock.mockResolvedValue(11314786);

    await getFiscalYearTrend(50);

    // forceRefreshされるのは当月(11月)のみのはずなので、それ以外はキャッシュ読み取りのみで
    // freeeへは問い合わせない。11月分だけ強制再取得(cache未読み取りでfetch)されることを確認
    const fetchedMonths = fetchMonthlyFinanceFromFreeeMock.mock.calls.map((call) => call[2]);
    expect(fetchedMonths).toEqual([11]);
  });

  it("force-refreshes only the current month, using cache for past months", async () => {
    getCurrentFiscalPeriodMock.mockReturnValue({ term: 50, currentMonth: 9 });
    getMonthlyFinanceSnapshotMock.mockResolvedValue(makeSnapshot());
    getFreeeCompanyIdMock.mockResolvedValue(11314786);
    fetchMonthlyFinanceFromFreeeMock.mockResolvedValue({ sales: 1 });

    const results = await getFiscalYearTrend(50);

    expect(results).toHaveLength(1); // 9月のみ経過済み
    expect(fetchMonthlyFinanceFromFreeeMock).toHaveBeenCalledTimes(1); // 当月分のみforceRefresh
  });

  it("fetches all 12 months for a fully past fiscal term (none are 'future')", async () => {
    getCurrentFiscalPeriodMock.mockReturnValue({ term: 50, currentMonth: 3 });
    getMonthlyFinanceSnapshotMock.mockResolvedValue(makeSnapshot());
    getFreeeCompanyIdMock.mockResolvedValue(11314786);

    await getFiscalYearTrend(49); // 49期は50期より前 → 全月が過去扱い

    expect(getMonthlyFinanceSnapshotMock).toHaveBeenCalledTimes(12);
  });
});
