import type { FreeeTrialBalanceResponse, FreeeTrialBalanceRow } from "@/services/freee/freeeAccountingClient";
import { getTrialPl } from "@/services/freee/freeeAccountingClient";
import { getFreeeCompanyId } from "@/repositories/freeeAuthRepository";

/**
 * 当期累計の経営サマリー(画面下部の補助セクション用)。月次ダッシュボードが主役に
 * なったため、現預金・売掛金等の累計BS値はここでは扱わない(月次CASHセクションに
 * 一本化、ユーザー確定、2026-09-14)。
 */
export interface FinancialSummary {
  revenue: number | null;
  grossProfit: number | null;
  /** %。累計ベースのためfreeeのcomposition_ratioをそのまま使用(単月とは異なり妥当) */
  grossProfitRate: number | null;
  operatingProfit: number | null;
  operatingProfitRate: number | null;
  ordinaryProfit: number | null;
}

/** Firestore(financialSummarySnapshots)へ保存するスナップショットの形。当期累計のため
 * fiscalYear/monthは「どの時点でfreeeから取得したか」のキー(常に当月)に過ぎない */
export interface FinancialSummarySnapshot extends FinancialSummary {
  fiscalYear: number;
  month: number;
  fetchedAt: Date;
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

export function extractPlSummary(trialPl: FreeeTrialBalanceResponse): FinancialSummary {
  const revenueRow = findSubtotalRow(trialPl.balances, "売上高");
  const grossProfitRow = findSubtotalRow(trialPl.balances, "売上総損益金額");
  const operatingProfitRow = findSubtotalRow(trialPl.balances, "営業損益金額");
  const ordinaryProfitRow = findSubtotalRow(trialPl.balances, "経常損益金額");
  return {
    revenue: revenueRow?.closing_balance ?? null,
    grossProfit: grossProfitRow?.closing_balance ?? null,
    grossProfitRate: grossProfitRow?.composition_ratio ?? null,
    operatingProfit: operatingProfitRow?.closing_balance ?? null,
    operatingProfitRate: operatingProfitRow?.composition_ratio ?? null,
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
export async function getFinancialSummary(fiscalYear: number): Promise<FinancialSummary | null> {
  const companyId = await getFreeeCompanyId();
  if (companyId === null) return null;

  const trialPl = await getTrialPl(companyId, { fiscalYear });
  return extractPlSummary(trialPl);
}
