import { describe, expect, it } from "vitest";
import type { FreeeTrialBalanceResponse, FreeeTrialBalanceRow } from "@/services/freee/freeeAccountingClient";
import { extractPlSummary } from "./financialSummary";
import { extractMonthlyPl, reconcileMonthlyPlWithSummary } from "./monthlyPl";

function subtotal(categoryName: string, opening: number, closing: number): FreeeTrialBalanceRow {
  return {
    hierarchy_level: 1,
    account_category_name: categoryName,
    total_line: true,
    opening_balance: opening,
    debit_amount: 0,
    credit_amount: 0,
    closing_balance: closing,
    composition_ratio: 0,
  };
}

/** freeeのtrial_plの形。[期首残高, 期末残高]で売上高・営業損益金額の小計行を作る */
function trialPl(revenue: [number, number], operatingProfit: [number, number]): FreeeTrialBalanceResponse {
  return {
    balances: [
      subtotal("売上高", ...revenue),
      subtotal("売上総損益金額", 0, 0),
      subtotal("営業損益金額", ...operatingProfit),
      subtotal("経常損益金額", 0, 0),
    ],
  } as FreeeTrialBalanceResponse;
}

describe("extractMonthlyPl", () => {
  it("期首月: 期首残高0なので、期末残高がそのまま単月値。営業コスト=売上高−営業利益", () => {
    expect(extractMonthlyPl(trialPl([0, 24_000_000], [0, -14_000_000]))).toEqual({
      revenue: 24_000_000,
      operatingProfit: -14_000_000,
      operatingCost: 38_000_000,
    });
  });

  it("2か月目以降: closing_balanceは期首からの累計なので、期末残高−期首残高を単月値にする", () => {
    // 売上の計上が無い月(期首残高=期末残高)でも、コストだけ発生して営業利益が減る
    expect(extractMonthlyPl(trialPl([24_000_000, 24_000_000], [-14_000_000, -16_000_000]))).toEqual({
      revenue: 0,
      operatingProfit: -2_000_000,
      operatingCost: 2_000_000,
    });
  });

  it("小計行が無ければnull(営業コストも算出しない)", () => {
    const response = { balances: [subtotal("売上高", 0, 100)] } as FreeeTrialBalanceResponse;

    expect(extractMonthlyPl(response)).toEqual({ revenue: 100, operatingProfit: null, operatingCost: null });
  });
});

describe("reconcileMonthlyPlWithSummary", () => {
  it("9月+10月の月次P/L合計は、当期累計サマリー(上部カード)の売上高・営業利益と一致する", () => {
    // freee実データで確認した関係(2026-10-08)を、同じ形の架空の金額で固定する:
    // 月指定のtrial_plは期首残高=前月末までの累計/期末残高=当月末までの累計で返り、
    // 当月の期末残高が、会計年度指定のみで取得した当期累計と同じ値になる
    const september = extractMonthlyPl(trialPl([0, 24_000_000], [0, -14_000_000]));
    const october = extractMonthlyPl(trialPl([24_000_000, 27_500_000], [-14_000_000, -16_000_000]));
    const termToDate = extractPlSummary(trialPl([0, 27_500_000], [0, -16_000_000]));

    expect(reconcileMonthlyPlWithSummary([september, october], termToDate)).toEqual({
      revenueDiff: 0,
      operatingProfitDiff: 0,
      matches: true,
    });
  });

  it("一致しない場合は数値を合わせず、差(月次合計 − 当期累計)をそのまま返す", () => {
    const monthly = [
      { revenue: 100, operatingProfit: -50 },
      { revenue: 200, operatingProfit: 30 },
    ];

    expect(reconcileMonthlyPlWithSummary(monthly, { revenue: 350, operatingProfit: -21 })).toEqual({
      revenueDiff: -50,
      operatingProfitDiff: 1,
      matches: false,
    });
  });

  it("どちらかに欠損があれば差はnullで、一致とはみなさない", () => {
    const result = reconcileMonthlyPlWithSummary(
      [{ revenue: 100, operatingProfit: null }],
      { revenue: 100, operatingProfit: -50 }
    );

    expect(result).toEqual({ revenueDiff: 0, operatingProfitDiff: null, matches: false });
  });
});
