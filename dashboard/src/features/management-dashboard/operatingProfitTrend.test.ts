import { afterEach, describe, expect, it, vi } from "vitest";
import type { FinancialSummarySnapshot } from "./financialSummary";

const getFinancialSummarySnapshotMock = vi.fn();

vi.mock("@/repositories/financialSummarySnapshotRepository", () => ({
  getFinancialSummarySnapshot: getFinancialSummarySnapshotMock,
}));

const { getOperatingProfitTrend } = await import("./operatingProfitTrend");

// 売上高=営業利益×100、粗利益=営業利益×10 とし、3系列が取り違えられていないことを検証できるようにする
function makeSnapshot(month: number, operatingProfit: number | null): FinancialSummarySnapshot {
  return {
    fiscalYear: 2026,
    month,
    revenue: operatingProfit === null ? null : operatingProfit * 100,
    grossProfit: operatingProfit === null ? null : operatingProfit * 10,
    grossProfitRate: null,
    operatingProfit,
    operatingProfitRate: null,
    ordinaryProfit: 0,
    fetchedAt: new Date("2026-09-01T00:00:00Z"),
  };
}

function point(month: number, operatingProfit: number | null) {
  return {
    month,
    cumulativeRevenue: operatingProfit === null ? null : operatingProfit * 100,
    cumulativeGrossProfit: operatingProfit === null ? null : operatingProfit * 10,
    cumulativeOperatingProfit: operatingProfit,
  };
}

afterEach(() => {
  getFinancialSummarySnapshotMock.mockReset();
});

describe("getOperatingProfitTrend", () => {
  it("9月(期首月)は当月分のみで、Firestoreは1件も読まない", async () => {
    const currentSummary = makeSnapshot(9, 123);

    const result = await getOperatingProfitTrend(2026, 9, currentSummary);

    expect(result).toEqual([point(9, 123)]);
    expect(getFinancialSummarySnapshotMock).not.toHaveBeenCalled();
  });

  it("当月より前の月はFirestoreキャッシュから読み、最新月は渡されたsummaryをそのまま使う(カードと必ず一致)", async () => {
    getFinancialSummarySnapshotMock.mockImplementation(async (_fiscalYear: number, month: number) =>
      makeSnapshot(month, month * 10)
    );
    const currentSummary = makeSnapshot(12, 999);

    const result = await getOperatingProfitTrend(2026, 12, currentSummary);

    expect(result).toEqual([
      point(9, 90),
      point(10, 100),
      point(11, 110),
      point(12, 999),
    ]);
  });

  it("過去月のキャッシュが無ければnull(推測しない。freeeへの再取得もしない)", async () => {
    getFinancialSummarySnapshotMock.mockResolvedValue(null);
    const currentSummary = makeSnapshot(10, 50);

    const result = await getOperatingProfitTrend(2026, 10, currentSummary);

    expect(result).toEqual([
      point(9, null),
      point(10, 50),
    ]);
  });

  it("当月分のsummaryがnull(freee未接続等)でも、過去月は影響を受けない", async () => {
    getFinancialSummarySnapshotMock.mockImplementation(async (_fiscalYear: number, month: number) =>
      makeSnapshot(month, month)
    );

    const result = await getOperatingProfitTrend(2026, 11, null);

    expect(result).toEqual([
      point(9, 9),
      point(10, 10),
      point(11, null),
    ]);
  });

  it("最新月の3系列は、渡されたsummaryの売上高・粗利益・営業利益そのもの(上部カードと同じ値)", async () => {
    getFinancialSummarySnapshotMock.mockResolvedValue(null);
    const currentSummary: FinancialSummarySnapshot = {
      ...makeSnapshot(10, 0),
      revenue: 5_000_000,
      grossProfit: 1_200_000,
      operatingProfit: -300_000,
      ordinaryProfit: -999_999,
    };

    const result = await getOperatingProfitTrend(2026, 10, currentSummary);

    expect(result[result.length - 1]).toEqual({
      month: 10,
      cumulativeRevenue: currentSummary.revenue,
      cumulativeGrossProfit: currentSummary.grossProfit,
      cumulativeOperatingProfit: currentSummary.operatingProfit,
    });
  });

  it("過去月スナップショットに売上高・粗利益のフィールドが無くても、その系列だけnullになる(補間しない)", async () => {
    getFinancialSummarySnapshotMock.mockResolvedValue({
      fiscalYear: 2026,
      month: 9,
      operatingProfit: 70,
      fetchedAt: new Date("2026-09-30T00:00:00Z"),
    });

    const result = await getOperatingProfitTrend(2026, 10, makeSnapshot(10, 5));

    expect(result[0]).toEqual({
      month: 9,
      cumulativeRevenue: null,
      cumulativeGrossProfit: null,
      cumulativeOperatingProfit: 70,
    });
  });

  it("翌8月(期末月)まで進んだ場合も12か月分すべてを走査する(1〜8月の暦またぎを含む)", async () => {
    getFinancialSummarySnapshotMock.mockImplementation(async (_fiscalYear: number, month: number) =>
      makeSnapshot(month, month)
    );
    const currentSummary = makeSnapshot(8, 800);

    const result = await getOperatingProfitTrend(2026, 8, currentSummary);

    expect(result.map((r) => r.month)).toEqual([9, 10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(result[result.length - 1]).toEqual(point(8, 800));
  });
});
