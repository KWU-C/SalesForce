import { describe, expect, it } from "vitest";
import { toBusinessBalanceRows } from "./businessBalanceRows";
import type { MonthlyPlPoint } from "./businessBalanceRows";

const FISCAL_MONTHS = [9, 10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8];

/** 単月の[売上高, 営業コスト]の並びから、月次P/Lの点を組み立てる */
function monthlyPoints(monthly: [number, number][]): MonthlyPlPoint[] {
  return monthly.map(([revenue, cost], i) => ({
    month: FISCAL_MONTHS[i],
    revenue,
    operatingProfit: revenue - cost,
    operatingCost: cost,
  }));
}

const MISSING = { revenue: null, operatingProfit: null, operatingCost: null };

describe("toBusinessBalanceRows", () => {
  it("9月のみ: 単月値はその月のP/Lそのまま、累積営業利益は9月の単月営業利益", () => {
    const rows = toBusinessBalanceRows(monthlyPoints([[20_000_000, 25_000_000]]));

    expect(rows).toEqual([
      { month: 9, monthlyRevenue: 20_000_000, monthlyOperatingCost: 25_000_000, cumulativeOperatingProfit: -5_000_000 },
    ]);
  });

  it("9〜10月: 累積営業利益は9月+10月の単月営業利益の合計", () => {
    const rows = toBusinessBalanceRows(monthlyPoints([[24_000_000, 38_000_000], [0, 2_000_000]]));

    expect(rows[1]).toEqual({
      month: 10,
      monthlyRevenue: 0,
      monthlyOperatingCost: 2_000_000,
      cumulativeOperatingProfit: -16_000_000,
    });
  });

  it("営業コストはコスト額として正の値のまま返す(マイナス方向への変換は描画側の責務)", () => {
    const rows = toBusinessBalanceRows(monthlyPoints([[100, 300], [200, 150]]));

    expect(rows.map((r) => r.monthlyOperatingCost)).toEqual([300, 150]);
  });

  it("6か月・12か月: 各月の累積営業利益が、単月売上 − 単月営業コストの積み上げに一致する", () => {
    const monthly: [number, number][] = [
      [100, 400], [300, 250], [500, 300], [200, 350], [800, 300], [600, 300],
      [100, 300], [900, 350], [400, 300], [700, 320], [300, 310], [1000, 400],
    ];
    for (const count of [6, 12]) {
      const rows = toBusinessBalanceRows(monthlyPoints(monthly.slice(0, count)));

      expect(rows.map((r) => r.month)).toEqual(FISCAL_MONTHS.slice(0, count));
      let running = 0;
      rows.forEach((row, i) => {
        expect([row.monthlyRevenue, row.monthlyOperatingCost]).toEqual(monthly[i]);
        running += monthly[i][0] - monthly[i][1];
        expect(row.cumulativeOperatingProfit).toBe(running);
      });
    }
  });

  it("単月黒字・単月赤字: 売上とコストの大小がそのまま出る", () => {
    const rows = toBusinessBalanceRows(monthlyPoints([[500, 300], [200, 600]]));

    expect(rows[0]).toMatchObject({ monthlyRevenue: 500, monthlyOperatingCost: 300, cumulativeOperatingProfit: 200 });
    expect(rows[1]).toMatchObject({ monthlyRevenue: 200, monthlyOperatingCost: 600, cumulativeOperatingProfit: -200 });
  });

  it("累積営業利益が赤字→黒字、黒字→赤字に転じるケース", () => {
    const toBlack = toBusinessBalanceRows(monthlyPoints([[100, 500], [300, 200], [900, 300]]));
    expect(toBlack.map((r) => r.cumulativeOperatingProfit)).toEqual([-400, -300, 300]);

    const toRed = toBusinessBalanceRows(monthlyPoints([[600, 300], [200, 300], [100, 500]]));
    expect(toRed.map((r) => r.cumulativeOperatingProfit)).toEqual([300, 200, -200]);
  });

  it("未取得の月: その月の棒は出さず、累積営業利益はその月以降すべてnull(欠損を0として積み上げない)", () => {
    const points = monthlyPoints([[100, 400], [300, 250], [500, 300], [200, 350]]);
    points[1] = { month: 10, ...MISSING };

    const rows = toBusinessBalanceRows(points);

    expect(rows[0]).toEqual({ month: 9, monthlyRevenue: 100, monthlyOperatingCost: 400, cumulativeOperatingProfit: -300 });
    expect(rows[1]).toEqual({ month: 10, monthlyRevenue: null, monthlyOperatingCost: null, cumulativeOperatingProfit: null });
    // 11月・12月の単月値は取得済みなので棒は出すが、累積は確定できない
    expect(rows[2]).toEqual({ month: 11, monthlyRevenue: 500, monthlyOperatingCost: 300, cumulativeOperatingProfit: null });
    expect(rows[3]).toEqual({ month: 12, monthlyRevenue: 200, monthlyOperatingCost: 350, cumulativeOperatingProfit: null });
  });

  it("全月が未取得なら、すべてnull", () => {
    const rows = toBusinessBalanceRows([{ month: 9, ...MISSING }, { month: 10, ...MISSING }]);

    expect(rows.every((r) => r.monthlyRevenue === null && r.cumulativeOperatingProfit === null)).toBe(true);
  });
});
