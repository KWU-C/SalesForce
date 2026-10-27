import { afterEach, describe, expect, it, vi } from "vitest";
import type { MonthlyPerformance, MonthlyPerformanceSnapshot } from "./monthlyPerformance";

const getSnapshotMock = vi.fn();
const saveSnapshotMock = vi.fn();
const getFreeeCompanyIdMock = vi.fn();
const fetchMonthlyPerformanceMock = vi.fn();

vi.mock("@/repositories/monthlyPerformanceSnapshotRepository", () => ({
  getMonthlyPerformanceSnapshot: getSnapshotMock,
  saveMonthlyPerformanceSnapshot: saveSnapshotMock,
}));
vi.mock("@/repositories/freeeAuthRepository", () => ({ getFreeeCompanyId: getFreeeCompanyIdMock }));
vi.mock("./monthlyPerformance", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./monthlyPerformance")>();
  return { ...actual, fetchMonthlyPerformance: fetchMonthlyPerformanceMock };
});

const { MONTHLY_PERFORMANCE_CALCULATION_VERSION } = await import("./monthlyPerformance");
const { getOrFetchTermPerformance, getStoredTermPerformance, refreshTermPerformance } = await import("./monthlyPerformanceService");

function perf(month: number): MonthlyPerformance {
  return { revenue: month * 100 } as MonthlyPerformance;
}

function cached(month: number, calculationVersion = MONTHLY_PERFORMANCE_CALCULATION_VERSION): MonthlyPerformanceSnapshot {
  return { ...perf(month), fiscalYear: 2025, month, fetchedAt: new Date(), calculationVersion };
}

afterEach(() => {
  getSnapshotMock.mockReset();
  saveSnapshotMock.mockReset();
  getFreeeCompanyIdMock.mockReset();
  fetchMonthlyPerformanceMock.mockReset();
});

describe("refreshTermPerformance", () => {
  it("期首〜指定月を順に取得してから全月を保存する", async () => {
    getFreeeCompanyIdMock.mockResolvedValue(1);
    fetchMonthlyPerformanceMock.mockImplementation(async (_c: number, _fy: number, m: number) => perf(m));
    const result = await refreshTermPerformance(2025, 11);
    expect(fetchMonthlyPerformanceMock.mock.calls.map((c) => c[2])).toEqual([9, 10, 11]);
    expect(result?.map((r) => r.month)).toEqual([9, 10, 11]);
    expect(saveSnapshotMock).toHaveBeenCalledTimes(3);
  });

  it("途中で失敗したら何も保存しない", async () => {
    getFreeeCompanyIdMock.mockResolvedValue(1);
    fetchMonthlyPerformanceMock.mockResolvedValueOnce(perf(9)).mockRejectedValueOnce(new Error("freee_api_error"));
    await expect(refreshTermPerformance(2025, 11)).rejects.toThrow("freee_api_error");
    expect(saveSnapshotMock).not.toHaveBeenCalled();
  });

  it("freee未接続ならnull", async () => {
    getFreeeCompanyIdMock.mockResolvedValue(null);
    expect(await refreshTermPerformance(2025, 11)).toBeNull();
  });
});

describe("getStoredTermPerformance", () => {
  it("Firestoreだけを読み、未保存・旧バージョンの月はnull(freeeは呼ばない)", async () => {
    getSnapshotMock.mockImplementation(async (_fy: number, m: number) =>
      m === 9 ? cached(9) : m === 10 ? cached(10, 0) : null
    );
    const result = await getStoredTermPerformance(2025, 11);
    expect(result.map((r) => r?.month ?? null)).toEqual([9, null, null]);
    expect(getFreeeCompanyIdMock).not.toHaveBeenCalled();
    expect(fetchMonthlyPerformanceMock).not.toHaveBeenCalled();
  });
});

describe("getOrFetchTermPerformance", () => {
  it("全月が保存済み(現行バージョン)ならfreeeを呼ばない", async () => {
    getSnapshotMock.mockImplementation(async (_fy: number, m: number) => cached(m));
    const result = await getOrFetchTermPerformance(2025, 10);
    expect(result?.map((r) => r?.month)).toEqual([9, 10]);
    expect(fetchMonthlyPerformanceMock).not.toHaveBeenCalled();
  });

  it("未保存・旧バージョンの月だけを取得して保存し、保存済みの月は取り直さない", async () => {
    getFreeeCompanyIdMock.mockResolvedValue(1);
    fetchMonthlyPerformanceMock.mockImplementation(async (_c: number, _fy: number, m: number) => perf(m));
    getSnapshotMock.mockImplementation(async (_fy: number, m: number) =>
      m === 9 ? cached(9, 0) : m === 11 ? null : cached(m)
    );
    const result = await getOrFetchTermPerformance(2025, 12);
    expect(fetchMonthlyPerformanceMock.mock.calls.map((c) => c[2])).toEqual([9, 11]);
    expect(saveSnapshotMock.mock.calls.map((c) => (c[0] as MonthlyPerformanceSnapshot).month)).toEqual([9, 11]);
    expect(result?.map((r) => r?.month)).toEqual([9, 10, 11, 12]);
  });

  it("未保存の月があってfreee未接続ならnull", async () => {
    getSnapshotMock.mockResolvedValue(null);
    getFreeeCompanyIdMock.mockResolvedValue(null);
    expect(await getOrFetchTermPerformance(2025, 9)).toBeNull();
  });
});
