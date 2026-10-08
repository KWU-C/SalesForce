import { afterEach, describe, expect, it, vi } from "vitest";
import type { MonthlyPl, MonthlyPlSnapshot } from "./monthlyPl";

const getMonthlyPlSnapshotMock = vi.fn();
const saveMonthlyPlSnapshotMock = vi.fn();
const getFreeeCompanyIdMock = vi.fn();
const fetchMonthlyPlMock = vi.fn();

vi.mock("@/repositories/monthlyPlSnapshotRepository", () => ({
  getMonthlyPlSnapshot: getMonthlyPlSnapshotMock,
  saveMonthlyPlSnapshot: saveMonthlyPlSnapshotMock,
}));
vi.mock("@/repositories/freeeAuthRepository", () => ({ getFreeeCompanyId: getFreeeCompanyIdMock }));
vi.mock("./monthlyPl", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./monthlyPl")>();
  return { ...actual, fetchMonthlyPl: fetchMonthlyPlMock };
});

const { MONTHLY_PL_CALCULATION_VERSION } = await import("./monthlyPl");
const { getOrFetchTermMonthlyPl, refreshTermMonthlyPl, termMonthsThrough } = await import("./monthlyPlService");

const ALL_MONTHS = [9, 10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8];

function pl(month: number): MonthlyPl {
  return { revenue: month * 100, operatingProfit: month * 10, operatingCost: month * 90 };
}

function cachedSnapshot(month: number, calculationVersion = MONTHLY_PL_CALCULATION_VERSION): MonthlyPlSnapshot {
  return { fiscalYear: 2026, month, ...pl(month), fetchedAt: new Date("2026-10-07T09:00:00Z"), calculationVersion };
}

function fetchedMonths(): number[] {
  return fetchMonthlyPlMock.mock.calls.map((call) => call[2] as number);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  getMonthlyPlSnapshotMock.mockReset();
  saveMonthlyPlSnapshotMock.mockReset();
  getFreeeCompanyIdMock.mockReset();
  fetchMonthlyPlMock.mockReset();
});

describe("termMonthsThrough", () => {
  it("期首(9月)から指定月までを返す(暦またぎを含む)", () => {
    expect(termMonthsThrough(9)).toEqual([9]);
    expect(termMonthsThrough(10)).toEqual([9, 10]);
    expect(termMonthsThrough(1)).toEqual([9, 10, 11, 12, 1]);
    expect(termMonthsThrough(8)).toEqual(ALL_MONTHS);
  });
});

describe("refreshTermMonthlyPl", () => {
  it("10月の更新では9月・10月を、1月の更新では9〜1月を、8月の更新では12か月すべてを取得する(過去月を固定しない)", async () => {
    getFreeeCompanyIdMock.mockResolvedValue(123);
    fetchMonthlyPlMock.mockImplementation(async (_companyId: number, _fiscalYear: number, month: number) => pl(month));

    for (const [currentMonth, expected] of [
      [10, [9, 10]],
      [1, [9, 10, 11, 12, 1]],
      [8, ALL_MONTHS],
    ] as [number, number[]][]) {
      fetchMonthlyPlMock.mockClear();

      const result = await refreshTermMonthlyPl(2026, currentMonth);

      expect(fetchedMonths()).toEqual(expected);
      expect(fetchMonthlyPlMock).toHaveBeenCalledWith(123, 2026, expected[0]);
      expect(result?.map((s) => s.month)).toEqual(expected);
    }
  });

  it("月ごとに1件、必要な項目をすべて持つスナップショットを保存する", async () => {
    getFreeeCompanyIdMock.mockResolvedValue(123);
    fetchMonthlyPlMock.mockResolvedValue({ revenue: 500, operatingProfit: -200, operatingCost: 700 });

    await refreshTermMonthlyPl(2026, 10);

    expect(saveMonthlyPlSnapshotMock).toHaveBeenCalledTimes(2);
    expect(saveMonthlyPlSnapshotMock.mock.calls[1][0]).toEqual({
      fiscalYear: 2026,
      month: 10,
      revenue: 500,
      operatingProfit: -200,
      operatingCost: 700,
      fetchedAt: expect.any(Date),
      calculationVersion: MONTHLY_PL_CALCULATION_VERSION,
    });
  });

  it("再実行しても同じ(fiscalYear, month)へ保存し直すだけで、保存対象の月は増えない(二重計上しない)", async () => {
    getFreeeCompanyIdMock.mockResolvedValue(123);
    fetchMonthlyPlMock.mockImplementation(async (_companyId: number, _fiscalYear: number, month: number) => pl(month));

    await refreshTermMonthlyPl(2026, 11);
    await refreshTermMonthlyPl(2026, 11);

    const savedKeys = saveMonthlyPlSnapshotMock.mock.calls.map(([s]) => `${s.fiscalYear}-${s.month}`);
    expect(savedKeys).toEqual(["2026-9", "2026-10", "2026-11", "2026-9", "2026-10", "2026-11"]);
    expect(new Set(savedKeys).size).toBe(3);
  });

  it("12か月更新: freee APIは12回だけ、同時に1件ずつ順に呼ぶ(無制限並列にしない)", async () => {
    getFreeeCompanyIdMock.mockResolvedValue(123);
    let inFlight = 0;
    let maxInFlight = 0;
    fetchMonthlyPlMock.mockImplementation(async (_companyId: number, _fiscalYear: number, month: number) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      return pl(month);
    });

    await refreshTermMonthlyPl(2026, 8);

    expect(fetchMonthlyPlMock).toHaveBeenCalledTimes(12);
    expect(maxInFlight).toBe(1);
    expect(getFreeeCompanyIdMock).toHaveBeenCalledTimes(1);
  });

  it("12か月更新: freeeの応答が1回5秒かかっても、Cloud Run Jobのtask-timeout(540秒)に収まる", async () => {
    // cloudbuild.yamlの--task-timeout=540s。実測は1回0.5〜0.8秒(2026-10-08)なので、その約6倍の遅さを想定
    const JOB_TASK_TIMEOUT_MS = 540_000;
    vi.useFakeTimers();
    getFreeeCompanyIdMock.mockResolvedValue(123);
    fetchMonthlyPlMock.mockImplementation(async (_companyId: number, _fiscalYear: number, month: number) => {
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      return pl(month);
    });
    const startedAt = Date.now();

    const pending = refreshTermMonthlyPl(2026, 8);
    await vi.runAllTimersAsync();
    await pending;

    const elapsedMs = Date.now() - startedAt;
    expect(elapsedMs).toBe(60_000);
    expect(elapsedMs).toBeLessThan(JOB_TASK_TIMEOUT_MS);
  });

  it("途中の月で取得に失敗したらthrowし、何も保存しない", async () => {
    getFreeeCompanyIdMock.mockResolvedValue(123);
    fetchMonthlyPlMock.mockImplementation(async (_companyId: number, _fiscalYear: number, month: number) => {
      if (month === 10) throw new Error("freee_api_error");
      return pl(month);
    });

    await expect(refreshTermMonthlyPl(2026, 11)).rejects.toThrow("freee_api_error");
    expect(saveMonthlyPlSnapshotMock).not.toHaveBeenCalled();
  });

  it("freee未接続ならnullを返し、freeeもFirestoreも呼ばない", async () => {
    getFreeeCompanyIdMock.mockResolvedValue(null);

    expect(await refreshTermMonthlyPl(2026, 10)).toBeNull();
    expect(fetchMonthlyPlMock).not.toHaveBeenCalled();
    expect(saveMonthlyPlSnapshotMock).not.toHaveBeenCalled();
  });
});

describe("getOrFetchTermMonthlyPl", () => {
  it("当月分が保存済みなら、Firestoreだけを読みfreeeは呼ばない", async () => {
    getMonthlyPlSnapshotMock.mockImplementation(async (_fiscalYear: number, month: number) => cachedSnapshot(month));

    const result = await getOrFetchTermMonthlyPl(2026, 11);

    expect(result?.map((s) => s?.month)).toEqual([9, 10, 11]);
    expect(fetchMonthlyPlMock).not.toHaveBeenCalled();
    expect(getFreeeCompanyIdMock).not.toHaveBeenCalled();
  });

  it("過去月だけ欠けている場合は、その月をnullのまま返す(表示時に勝手に取得・補間しない)", async () => {
    getMonthlyPlSnapshotMock.mockImplementation(async (_fiscalYear: number, month: number) =>
      month === 10 ? null : cachedSnapshot(month)
    );

    const result = await getOrFetchTermMonthlyPl(2026, 11);

    expect(result?.map((s) => s?.month ?? null)).toEqual([9, null, 11]);
    expect(fetchMonthlyPlMock).not.toHaveBeenCalled();
  });

  it("当月分が未保存なら、期首から当月までの全月をfreeeから取得して保存する", async () => {
    getMonthlyPlSnapshotMock.mockImplementation(async (_fiscalYear: number, month: number) =>
      month === 10 ? null : cachedSnapshot(month)
    );
    getFreeeCompanyIdMock.mockResolvedValue(123);
    fetchMonthlyPlMock.mockImplementation(async (_companyId: number, _fiscalYear: number, month: number) => pl(month));

    const result = await getOrFetchTermMonthlyPl(2026, 10);

    expect(fetchedMonths()).toEqual([9, 10]);
    expect(saveMonthlyPlSnapshotMock).toHaveBeenCalledTimes(2);
    expect(result?.map((s) => s?.month)).toEqual([9, 10]);
  });

  it("算出バージョンが古い保存済みデータは未取得として扱う", async () => {
    getMonthlyPlSnapshotMock.mockImplementation(async (_fiscalYear: number, month: number) =>
      cachedSnapshot(month, month === 9 ? MONTHLY_PL_CALCULATION_VERSION - 1 : MONTHLY_PL_CALCULATION_VERSION)
    );

    const result = await getOrFetchTermMonthlyPl(2026, 10);

    expect(result?.map((s) => s?.month ?? null)).toEqual([null, 10]);
  });

  it("forceRefresh=trueなら保存済みでもFirestoreを読まず、全月をfreeeから取り直す", async () => {
    getFreeeCompanyIdMock.mockResolvedValue(123);
    fetchMonthlyPlMock.mockImplementation(async (_companyId: number, _fiscalYear: number, month: number) => pl(month));

    await getOrFetchTermMonthlyPl(2026, 12, { forceRefresh: true });

    expect(getMonthlyPlSnapshotMock).not.toHaveBeenCalled();
    expect(fetchedMonths()).toEqual([9, 10, 11, 12]);
  });
});
