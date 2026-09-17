import { getValidFreeeAccessToken } from "@/repositories/freeeAuthRepository";

const BASE_URL = "https://api.freee.co.jp";
const PAGE_LIMIT = 100;

export interface FreeeWalletTxn {
  id: number;
  date: string;
  amount: number;
  entry_side: "income" | "expense";
  walletable_type: "bank_account" | "credit_card" | "wallet";
  walletable_id: number;
}

export interface FreeeTransfer {
  id: number;
  amount: number;
  date: string;
  from_walletable_id: number;
  to_walletable_id: number;
}

export interface FreeeDealDetail {
  account_item_id: number;
  amount: number;
}

export interface FreeeDealPayment {
  date: string;
  amount: number;
  from_walletable_id: number | null;
}

export interface FreeeDeal {
  id: number;
  type: "income" | "expense";
  issue_date: string;
  details: FreeeDealDetail[];
  // 未決済(status=unsettled)のdealはこのキー自体が存在しないことがある(実データで確認済み)
  payments?: FreeeDealPayment[];
}

export interface FreeeAccountItem {
  id: number;
  name: string;
  walletable_id?: number;
}

export interface FreeeWalletable {
  id: number;
  type: "bank_account" | "credit_card" | "wallet";
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
    console.error(`[freeeTransactionClient] ${path} がエラーを返しました(status=${res.status})`);
    throw new Error("freee_api_error");
  }
  return (await res.json()) as T;
}

async function freeeGetPaginated<T>(
  path: string,
  params: Record<string, string | number | undefined>,
  key: string
): Promise<T[]> {
  const results: T[] = [];
  let offset = 0;
  for (;;) {
    const data = await freeeGet<Record<string, T[]>>(path, { ...params, offset, limit: PAGE_LIMIT });
    const batch = data[key];
    results.push(...batch);
    if (batch.length < PAGE_LIMIT) break;
    offset += PAGE_LIMIT;
  }
  return results;
}

export async function getWalletTxns(
  companyId: number,
  startDate: string,
  endDate: string
): Promise<FreeeWalletTxn[]> {
  return freeeGetPaginated<FreeeWalletTxn>(
    "/api/1/wallet_txns",
    { company_id: companyId, start_date: startDate, end_date: endDate },
    "wallet_txns"
  );
}

export async function getTransfers(companyId: number, startDate: string, endDate: string): Promise<FreeeTransfer[]> {
  return freeeGetPaginated<FreeeTransfer>(
    "/api/1/transfers",
    { company_id: companyId, start_date: startDate, end_date: endDate },
    "transfers"
  );
}

/** type別の取引(deal)を発生日で取得する(収入/支出共通)。 */
export async function getDeals(
  companyId: number,
  type: "income" | "expense",
  startIssueDate: string,
  endIssueDate: string
): Promise<FreeeDeal[]> {
  return freeeGetPaginated<FreeeDeal>(
    "/api/1/deals",
    { company_id: companyId, type, start_issue_date: startIssueDate, end_issue_date: endIssueDate },
    "deals"
  );
}

/**
 * 支出取引(type=expense)を発生日で取得する。発生日と実際の決済日はずれることが
 * あるため(実データで確認済み)、対象月より広めの発生日範囲で取得し、呼び出し側で
 * payments[].dateが対象月かどうかを判定すること。
 */
export async function getExpenseDeals(
  companyId: number,
  startIssueDate: string,
  endIssueDate: string
): Promise<FreeeDeal[]> {
  return getDeals(companyId, "expense", startIssueDate, endIssueDate);
}

export async function getAccountItems(companyId: number): Promise<FreeeAccountItem[]> {
  const data = await freeeGet<{ account_items: FreeeAccountItem[] }>("/api/1/account_items", {
    company_id: companyId,
  });
  return data.account_items;
}

export async function getWalletables(companyId: number): Promise<FreeeWalletable[]> {
  const data = await freeeGet<{ walletables: FreeeWalletable[] }>("/api/1/walletables", { company_id: companyId });
  return data.walletables;
}
