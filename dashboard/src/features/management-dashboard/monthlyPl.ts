import type { FreeeTrialBalanceResponse, FreeeTrialBalanceRow } from "@/services/freee/freeeAccountingClient";
import { getTrialPl } from "@/services/freee/freeeAccountingClient";

/**
 * 月次P/Lの算出方法のバージョン。算出式や取得条件を変えたら上げる。保存済みドキュメントの
 * calculationVersionがこれと異なる場合、読み出し側は「未取得」として扱う(古い定義の値を
 * 新しい定義の値と混ぜて合計しないため)。
 * - 1: freeeのtrial_plを月指定(start_month=end_month)で取得し、小計行の
 *      「期末残高 − 期首残高」を単月値とする
 */
export const MONTHLY_PL_CALCULATION_VERSION = 1;

/** 単月のP/L実績(事業収支の推移グラフの元データ) */
export interface MonthlyPl {
  /** 単月売上高 */
  revenue: number | null;
  /** 単月営業利益 */
  operatingProfit: number | null;
  /** 単月営業コスト(売上原価+販管費に相当) = 単月売上高 − 単月営業利益。コスト額として正の値 */
  operatingCost: number | null;
}

/** Firestore(monthlyPlSnapshots)へ保存する形。(fiscalYear, month)ごとに1件を上書きする */
export interface MonthlyPlSnapshot extends MonthlyPl {
  fiscalYear: number;
  /** 暦月(1〜12) */
  month: number;
  fetchedAt: Date;
  calculationVersion: number;
}

function findSubtotalRow(balances: FreeeTrialBalanceRow[], categoryName: string): FreeeTrialBalanceRow | null {
  return balances.find((b) => b.total_line === true && b.account_category_name === categoryName) ?? null;
}

// 月指定で取得したtrial_plでも、closing_balanceは「期首からその月末までの累計」で返る
// (opening_balanceが前月末までの累計。freee実データで確認済み、2026-10-08)。
// そのため単月の発生額は「期末残高 − 期首残高」で求める
function periodAmount(row: FreeeTrialBalanceRow | null): number | null {
  return row === null ? null : row.closing_balance - row.opening_balance;
}

/** 月指定(start_month=end_month)で取得したtrial_plから、その月の単月P/Lを取り出す */
export function extractMonthlyPl(trialPl: FreeeTrialBalanceResponse): MonthlyPl {
  const revenue = periodAmount(findSubtotalRow(trialPl.balances, "売上高"));
  const operatingProfit = periodAmount(findSubtotalRow(trialPl.balances, "営業損益金額"));
  return {
    revenue,
    operatingProfit,
    operatingCost: revenue === null || operatingProfit === null ? null : revenue - operatingProfit,
  };
}

/**
 * freeeから指定月の単月P/Lを取得する(freee APIを1回呼ぶ)。fiscalYearは
 * getFinancialSummaryと同じく、必ずアプリ側の事業期定義(freeeFiscalYearForTerm)から渡すこと。
 */
export async function fetchMonthlyPl(companyId: number, fiscalYear: number, month: number): Promise<MonthlyPl> {
  const trialPl = await getTrialPl(companyId, { fiscalYear, startMonth: month, endMonth: month });
  return extractMonthlyPl(trialPl);
}

/** 月次P/Lの合計と当期累計サマリー(上部カード)の検算結果。差 = 月次合計 − 当期累計 */
export interface MonthlyPlReconciliation {
  /** どちらかに欠損があり比較できない場合はnull */
  revenueDiff: number | null;
  operatingProfitDiff: number | null;
  /** 売上高・営業利益とも差が0の場合のみtrue(比較できない場合はfalse) */
  matches: boolean;
}

function sumOrNull(values: (number | null)[]): number | null {
  let total = 0;
  for (const v of values) {
    if (v === null) return null;
    total += v;
  }
  return total;
}

/**
 * 同じ更新処理で取得した「期首〜当月の月次P/L合計」と「当期累計サマリー」を突き合わせる。
 * 一致しない場合でも数値は一切補正せず、差をそのまま返す(原因を確認できるようにするため。
 * 例: 当月より先の日付の仕訳は当期累計には入るが、期首〜当月の月次合計には入らない)。
 */
export function reconcileMonthlyPlWithSummary(
  monthly: Pick<MonthlyPl, "revenue" | "operatingProfit">[],
  summary: { revenue: number | null; operatingProfit: number | null }
): MonthlyPlReconciliation {
  const revenueTotal = sumOrNull(monthly.map((m) => m.revenue));
  const operatingProfitTotal = sumOrNull(monthly.map((m) => m.operatingProfit));
  const revenueDiff = revenueTotal === null || summary.revenue === null ? null : revenueTotal - summary.revenue;
  const operatingProfitDiff =
    operatingProfitTotal === null || summary.operatingProfit === null
      ? null
      : operatingProfitTotal - summary.operatingProfit;
  return { revenueDiff, operatingProfitDiff, matches: revenueDiff === 0 && operatingProfitDiff === 0 };
}
