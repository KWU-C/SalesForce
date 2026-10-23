import type { FreeeTrialBalanceResponse, FreeeTrialBalanceRow } from "@/services/freee/freeeAccountingClient";
import { getTrialPl } from "@/services/freee/freeeAccountingClient";
import { getFreeeCompanyId } from "@/repositories/freeeAuthRepository";
import { FISCAL_MONTH_ORDER } from "@/config/fiscalPeriods";

/**
 * 当期累計の経営サマリー(画面下部の補助セクション用)。月次ダッシュボードが主役に
 * なったため、現預金・売掛金等の累計BS値はここでは扱わない(月次CASHセクションに
 * 一本化、ユーザー確定、2026-09-14)。
 */
export interface FinancialSummary {
  revenue: number | null;
  grossProfit: number | null;
  /** %。利益÷売上高で求める符号付きの値(損失ならマイナス)。profitRate参照 */
  grossProfitRate: number | null;
  operatingProfit: number | null;
  operatingProfitRate: number | null;
  ordinaryProfit: number | null;
}

/**
 * 当期累計の算出方法のバージョン。保存済みスナップショットのcalculationVersionがこれと異なる場合、
 * 読み出し側は「未取得」として扱う(古い定義の値を表示しない。一括の書き換えはしない)。
 * - 1(項目なし): trial_plを事業期(fiscal_year)だけで取得。期の全体(翌8月まで)を集計するため、
 *   先の日付で登録済みの仕訳(前払費用の+更新、借入の返済予定の利息など)まで含んでいた
 * - 2: 期首(9月)〜対象月末で取得する(ユーザー確定、2026-10-23)
 */
export const FINANCIAL_SUMMARY_CALCULATION_VERSION = 2;

/** Firestore(financialSummarySnapshots)へ保存するスナップショットの形。fiscalYear/monthは
 * 累計の対象(期首〜monthの月末)を表す */
export interface FinancialSummarySnapshot extends FinancialSummary {
  fiscalYear: number;
  month: number;
  fetchedAt: Date;
  /** 項目追加前(バージョン1)の保存分には無い */
  calculationVersion?: number;
}

// trial_plの小計行は total_line: true で、account_category_nameがラベルになる
// (freee実データで確認済み、2026-09-14)。この行にはaccount_item_nameのキー自体が
// 存在しない(undefinedであり、nullではない)
function findSubtotalRow(
  balances: FreeeTrialBalanceRow[],
  categoryName: string
): FreeeTrialBalanceRow | null {
  return balances.find((b) => b.total_line === true && b.account_category_name === categoryName) ?? null;
}

/**
 * 利益率(%) = 利益 ÷ 売上高 × 100。損失ならマイナスになる。売上高が0・未取得ならnull。
 * freeeのcomposition_ratio(構成比)は符号の無い絶対値で返るため使わない。営業損失
 * −13,859,051円に対して「営業利益率 49.27%」と表示されていた(2026-10-15発見、ユーザー指示で修正)。
 * 保存済みスナップショットにも旧値が残るため、表示側もこの関数で金額から計算し直す。
 */
export function profitRate(profit: number | null, revenue: number | null): number | null {
  if (profit === null || revenue === null || revenue === 0) return null;
  return (profit / revenue) * 100;
}

export function extractPlSummary(trialPl: FreeeTrialBalanceResponse): FinancialSummary {
  const revenueRow = findSubtotalRow(trialPl.balances, "売上高");
  const grossProfitRow = findSubtotalRow(trialPl.balances, "売上総損益金額");
  const operatingProfitRow = findSubtotalRow(trialPl.balances, "営業損益金額");
  const ordinaryProfitRow = findSubtotalRow(trialPl.balances, "経常損益金額");
  const revenue = revenueRow?.closing_balance ?? null;
  const grossProfit = grossProfitRow?.closing_balance ?? null;
  const operatingProfit = operatingProfitRow?.closing_balance ?? null;
  return {
    revenue,
    grossProfit,
    grossProfitRate: profitRate(grossProfit, revenue),
    operatingProfit,
    operatingProfitRate: profitRate(operatingProfit, revenue),
    ordinaryProfit: ordinaryProfitRow?.closing_balance ?? null,
  };
}

/**
 * freee接続済みの事業所から当期累計の経営サマリーを取得する。company_id未確定
 * (未接続)の場合はnull。取得失敗時はそのままthrowする(呼び出し側でページ全体を
 * 落とさないようcatchする想定)。
 *
 * fiscalYearは必ずこのアプリ側の事業期定義(freeeFiscalYearForTerm、9月始まり)から
 * 明示的に渡すこと。省略するとfreee側の「当期」判定に委ねることになるが、実データで
 * 確認したところ、事業期が切り替わった直後(例: 49期の決算がfreee上でまだ締まって
 * いない時期)はfreee側がまだ前期を「当期」として返し続けることがあり、画面の
 * 「当期累計」ラベルと矛盾した金額(前期の通期累計)が表示されるバグがあった
 * (2026-09-18発見)。
 */
export async function getFinancialSummary(fiscalYear: number, endMonth: number): Promise<FinancialSummary | null> {
  const companyId = await getFreeeCompanyId();
  if (companyId === null) return null;

  // 期首(9月)〜対象月末に限る。月を指定しないと期の全体(翌8月まで)が集計され、先の日付の仕訳が入る
  const trialPl = await getTrialPl(companyId, { fiscalYear, startMonth: FISCAL_MONTH_ORDER[0], endMonth });
  return extractPlSummary(trialPl);
}
