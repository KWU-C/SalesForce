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
 */
export async function getFinancialSummary(): Promise<FinancialSummary | null> {
  const companyId = await getFreeeCompanyId();
  if (companyId === null) return null;

  const trialPl = await getTrialPl(companyId);
  return extractPlSummary(trialPl);
}
