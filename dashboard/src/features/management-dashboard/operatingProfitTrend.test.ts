import { afterEach, describe, expect, it, vi } from "vitest";
import type { FinancialSummarySnapshot } from "./financialSummary";

const getFinancialSummarySnapshotMock = vi.fn();

vi.mock("@/repositories/financialSummarySnapshotRepository", () => ({
  getFinancialSummarySnapshot: getFinancialSummarySnapshotMock,
}));

const { getOperatingProfitTrend } = await import("./operatingProfitTrend");

function makeSnapshot(month: number, operatingProfit: number | null): FinancialSummarySnapshot {
  return {
    fiscalYear: 2026,
    month,
    revenue: 0,
    grossProfit: 0,
    grossProfitRate: null,
    operatingProfit,
    operatingProfitRate: null,
    ordinaryProfit: 0,
    fetchedAt: new Date("2026-09-01T00:00:00Z"),
  };
}

afterEach(() => {
  getFinancialSummarySnapshotMock.mockReset();
});

describe("getOperatingProfitTrend", () => {
  it("9月(期首月)は当月分のみで、Firestoreは1件も読まない", async () => {
    const currentSummary = makeSnapshot(9, 123);

    const result = await getOperatingProfitTrend(2026, 9, currentSummary);

    expect(result).toEqual([{ month: 9, cumulativeOperatingProfit: 123 }]);
    expect(getFinancialSummarySnapshotMock).not.toHaveBeenCalled();
  });

  it("当月より前の月はFirestoreキャッシュから読み、最新月は渡されたsummaryをそのまま使う(カードと必ず一致)", async () => {
    getFinancialSummarySnapshotMock.mockImplementation(async (_fiscalYear: number, month: number) =>
      makeSnapshot(month, month * 10)
    );
    const currentSummary = makeSnapshot(12, 999);

    const result = await getOperatingProfitTrend(2026, 12, currentSummary);

    expect(result).toEqual([
      { month: 9, cumulativeOperatingProfit: 90 },
      { month: 10, cumulativeOperatingProfit: 100 },
      { month: 11, cumulativeOperatingProfit: 110 },
      { month: 12, cumulativeOperatingProfit: 999 },
    ]);
  });

  it("過去月のキャッシュが無ければnull(推測しない。freeeへの再取得もしない)", async () => {
    getFinancialSummarySnapshotMock.mockResolvedValue(null);
    const currentSummary = makeSnapshot(10, 50);

    const result = await getOperatingProfitTrend(2026, 10, currentSummary);

    expect(result).toEqual([
      { month: 9, cumulativeOperatingProfit: null },
      { month: 10, cumulativeOperatingProfit: 50 },
    ]);
  });

  it("当月分のsummaryがnull(freee未接続等)でも、過去月は影響を受けない", async () => {
    getFinancialSummarySnapshotMock.mockImplementation(async (_fiscalYear: number, month: number) =>
      makeSnapshot(month, month)
    );

    const result = await getOperatingProfitTrend(2026, 11, null);

    expect(result).toEqual([
      { month: 9, cumulativeOperatingProfit: 9 },
      { month: 10, cumulativeOperatingProfit: 10 },
      { month: 11, cumulativeOperatingProfit: null },
    ]);
  });

  it("翌8月(期末月)まで進んだ場合も12か月分すべてを走査する(1〜8月の暦またぎを含む)", async () => {
    getFinancialSummarySnapshotMock.mockImplementation(async (_fiscalYear: number, month: number) =>
      makeSnapshot(month, month)
    );
    const currentSummary = makeSnapshot(8, 800);

    const result = await getOperatingProfitTrend(2026, 8, currentSummary);

    expect(result.map((r) => r.month)).toEqual([9, 10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(result[result.length - 1]).toEqual({ month: 8, cumulativeOperatingProfit: 800 });
  });
});
