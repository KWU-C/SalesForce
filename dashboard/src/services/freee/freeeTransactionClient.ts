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

export interface FreeeAccountItem {
  id: number;
  name: string;
  /** 勘定科目カテゴリ名(例: 売上債権・販売管理費・投資その他の資産)。入金の相手科目分類に使う(cashInflow.ts) */
  account_category?: string;
  walletable_id?: number;
}

export interface FreeeWalletable {
  id: number;
  type: "bank_account" | "credit_card" | "wallet";
  /** 口座名。仕訳帳CSVの現金・預金行の補助科目名と一致する(cashInflow.tsで口座を特定するキー) */
  name?: string;
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
