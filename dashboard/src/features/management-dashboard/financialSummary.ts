import type {
  FreeeTrialBalanceResponse,
  FreeeTrialBalanceRow,
  FreeeWalletable,
} from "@/services/freee/freeeAccountingClient";
import { getTrialBs, getTrialPl, getWalletables } from "@/services/freee/freeeAccountingClient";
import { getFreeeCompanyId } from "@/repositories/freeeAuthRepository";

export interface FinancialSummary {
  /** 売上高(当期累計) */
  revenue: number | null;
  /** 粗利益(売上総損益金額、当期累計) */
  grossProfit: number | null;
  /** 粗利率(%、freeeのcomposition_ratioをそのまま使用) */
  grossProfitRate: number | null;
  /** 営業利益(当期累計) */
  operatingProfit: number | null;
  /** 営業利益率(%) */
  operatingProfitRate: number | null;
  /** 経常利益(当期累計) */
  ordinaryProfit: number | null;
  /** 現預金(口座残高合計、現時点) */
  cashAndDeposits: number | null;
  /** 売掛金(現時点) */
  accountsReceivable: number | null;
  /** 買掛金+未払金の合計(現時点) */
  accountsPayable: number | null;
  /** 借入金(短期+長期+役員、現時点) */
  borrowings: number | null;
}

// trial_pl/trial_bsの小計行はaccount_item_nameがnullで、hierarchy_level=1・
// account_category_nameがラベルになる(freee実データで確認済み、2026-09-14)。
// 例: 売上総損益金額=粗利益、営業損益金額=営業利益、経常損益金額=経常利益
function findSubtotalRow(
  balances: FreeeTrialBalanceRow[],
  categoryName: string
): FreeeTrialBalanceRow | null {
  return (
    balances.find(
      (b) => b.hierarchy_level === 1 && b.account_item_name === null && b.account_category_name === categoryName
    ) ?? null
  );
}

function findLeafRow(balances: FreeeTrialBalanceRow[], accountItemName: string): FreeeTrialBalanceRow | null {
  return balances.find((b) => b.account_item_name === accountItemName) ?? null;
}

/** 複数の勘定科目名を合算する。1件も見つからない場合はnull(0円ではなく"未確認"扱い) */
function sumLeafRows(balances: FreeeTrialBalanceRow[], accountItemNames: string[]): number | null {
  const rows = accountItemNames
    .map((name) => findLeafRow(balances, name))
    .filter((row): row is FreeeTrialBalanceRow => row !== null);
  if (rows.length === 0) return null;
  return rows.reduce((sum, row) => sum + row.closing_balance, 0);
}

export function extractPlSummary(
  trialPl: FreeeTrialBalanceResponse
): Pick<
  FinancialSummary,
  "revenue" | "grossProfit" | "grossProfitRate" | "operatingProfit" | "operatingProfitRate" | "ordinaryProfit"
> {
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

export function extractBsSummary(
  trialBs: FreeeTrialBalanceResponse
): Pick<FinancialSummary, "accountsReceivable" | "accountsPayable" | "borrowings"> {
  return {
    accountsReceivable: findLeafRow(trialBs.balances, "売掛金")?.closing_balance ?? null,
    accountsPayable: sumLeafRows(trialBs.balances, ["買掛金", "未払金"]),
    borrowings: sumLeafRows(trialBs.balances, ["短期借入金", "長期借入金", "役員借入金"]),
  };
}

export function sumCashAndDeposits(walletables: FreeeWalletable[]): number | null {
  if (walletables.length === 0) return null;
  return walletables.reduce((sum, w) => sum + (w.walletable_balance ?? w.last_balance ?? 0), 0);
}

/**
 * freee接続済みの事業所から経営サマリーを取得する。company_id未確定(未接続)の場合はnull。
 * 個別のfreee APIが失敗した場合はそのままthrowする(呼び出し側でページ全体を落とさない
 * ようcatchする想定、既存のprocessMemos取得と同じ方針)。
 */
export async function getFinancialSummary(): Promise<FinancialSummary | null> {
  const companyId = await getFreeeCompanyId();
  if (companyId === null) return null;

  const [trialPl, trialBs, walletables] = await Promise.all([
    getTrialPl(companyId),
    getTrialBs(companyId),
    getWalletables(companyId),
  ]);

  return {
    ...extractPlSummary(trialPl),
    ...extractBsSummary(trialBs),
    cashAndDeposits: sumCashAndDeposits(walletables),
  };
}
