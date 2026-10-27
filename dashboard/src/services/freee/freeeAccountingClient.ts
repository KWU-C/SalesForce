import { getValidFreeeAccessToken } from "@/repositories/freeeAuthRepository";

const BASE_URL = "https://api.freee.co.jp";

export interface FreeeTrialBalanceRow {
  // 小計行(売上総損益金額等)ではaccount_item_id/account_item_nameのキー自体が
  // レスポンスに存在しない(null値ではなく欠落。実データで確認済み、2026-09-14)
  account_item_id?: number;
  account_item_name?: string;
  hierarchy_level: number;
  account_category_name: string;
  /** true の行が売上総損益金額・営業損益金額等の小計行(実データで確認済み) */
  total_line?: boolean;
  opening_balance: number;
  debit_amount: number;
  credit_amount: number;
  closing_balance: number;
  composition_ratio: number;
  /** breakdown_display_type=partner で取得した場合の取引先別内訳(未選択はid=0・name=「未選択」) */
  partners?: FreeeTrialBalanceBreakdown[];
  /** breakdown_display_type=item で取得した場合の品目別内訳(未選択はid=0・name=「未選択」) */
  items?: FreeeTrialBalanceBreakdown[];
}

/** 試算表の科目行の内訳(取引先別・品目別)。内訳の合計は科目の金額と一致する(49期で確認済み、2026-10-27) */
export interface FreeeTrialBalanceBreakdown {
  id: number;
  name: string;
  opening_balance: number;
  debit_amount: number;
  credit_amount: number;
  closing_balance: number;
}

export interface FreeeTrialBalanceResponse {
  company_id: number;
  fiscal_year: number;
  balances: FreeeTrialBalanceRow[];
}

export interface FreeeWalletable {
  id: number;
  name: string;
  type: "bank_account" | "credit_card" | "wallet";
  walletable_balance?: number;
  last_balance?: number;
}

async function freeeGet<T>(path: string, params: Record<string, string | number | undefined>): Promise<T> {
  const token = await getValidFreeeAccessToken();
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, String(value));
  }
  const res = await fetch(`${BASE_URL}${path}?${query.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    // レスポンス本文に事業所の実データが含まれ得るため、ステータスのみログに出す
    console.error(`[freeeAccountingClient] ${path} がエラーを返しました(status=${res.status})`);
    throw new Error("freee_api_error");
  }
  return (await res.json()) as T;
}

/** 損益計算書。fiscalYear等を省略すると現在の会計年度・期首からの累計が返る(freeeのデフォルト挙動) */
export async function getTrialPl(
  companyId: number,
  filters: { fiscalYear?: number; startMonth?: number; endMonth?: number } = {}
): Promise<FreeeTrialBalanceResponse> {
  const data = await freeeGet<{ trial_pl: FreeeTrialBalanceResponse }>("/api/1/reports/trial_pl", {
    company_id: companyId,
    fiscal_year: filters.fiscalYear,
    start_month: filters.startMonth,
    end_month: filters.endMonth,
  });
  return data.trial_pl;
}

/** 試算表の内訳の種類。取引先別(partner)・品目別(item) */
export type FreeeTrialBreakdown = "partner" | "item";

/**
 * 損益計算書を内訳付きで取得する。月指定で取得してもclosing_balanceは期首からの累計で返る
 * (getTrialPlと同じ)。内訳(partners/items)の各行も同じ形式
 */
export async function getTrialPlWithBreakdown(
  companyId: number,
  filters: { fiscalYear: number; startMonth: number; endMonth: number; breakdown: FreeeTrialBreakdown }
): Promise<FreeeTrialBalanceResponse> {
  const data = await freeeGet<{ trial_pl: FreeeTrialBalanceResponse }>("/api/1/reports/trial_pl", {
    company_id: companyId,
    fiscal_year: filters.fiscalYear,
    start_month: filters.startMonth,
    end_month: filters.endMonth,
    breakdown_display_type: filters.breakdown,
  });
  return data.trial_pl;
}

/**
 * 製造原価報告書(労務費・製造経費・仕掛品)を内訳付きで取得する。期間の扱いは損益計算書と同じ。
 * 損益計算書の「当期製品製造原価」はこの「製造原価」と一致する
 */
export async function getTrialCrWithBreakdown(
  companyId: number,
  filters: { fiscalYear: number; startMonth: number; endMonth: number; breakdown: FreeeTrialBreakdown }
): Promise<FreeeTrialBalanceResponse> {
  const data = await freeeGet<{ trial_cr: FreeeTrialBalanceResponse }>("/api/1/reports/trial_cr", {
    company_id: companyId,
    fiscal_year: filters.fiscalYear,
    start_month: filters.startMonth,
    end_month: filters.endMonth,
    breakdown_display_type: filters.breakdown,
  });
  return data.trial_cr;
}

/** 貸借対照表(試算表)。同上、省略時は現在の会計年度の期末時点(現時点)の残高 */
export async function getTrialBs(
  companyId: number,
  filters: { fiscalYear?: number; startMonth?: number; endMonth?: number } = {}
): Promise<FreeeTrialBalanceResponse> {
  const data = await freeeGet<{ trial_bs: FreeeTrialBalanceResponse }>("/api/1/reports/trial_bs", {
    company_id: companyId,
    fiscal_year: filters.fiscalYear,
    start_month: filters.startMonth,
    end_month: filters.endMonth,
  });
  return data.trial_bs;
}

export async function getWalletables(companyId: number): Promise<FreeeWalletable[]> {
  const data = await freeeGet<{ walletables: FreeeWalletable[] }>("/api/1/walletables", {
    company_id: companyId,
    with_balance: "true",
  });
  return data.walletables;
}
