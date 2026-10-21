import { getValidFreeeAccessToken } from "@/repositories/freeeAuthRepository";

/**
 * 資金繰り予測(第2段階)専用のfreee読み取り。既存のクライアント(月次資金収支など)は変えず、
 * 予測に必要な取得だけをここに置く(ユーザー確定、2026-10-21)。すべてGETのみ。
 *
 * 失敗の種類を呼び出し側で区別できるよう、HTTPステータスから FreeeReadError.kind を決める。
 * 予測は「どれか1つでも取得に失敗したら予測値を作らない(0円にしない)」ため、権限不足(403)と
 * それ以外を分けて画面に出せるようにする。
 */

const ACCOUNTING_BASE_URL = "https://api.freee.co.jp";
const HR_BASE_URL = "https://api.freee.co.jp/hr";
const PAGE_LIMIT = 100;
/** 1回の一覧取得で読む最大ページ数(想定外の大量データで定時更新が止まらないようにする) */
const MAX_PAGES = 60;

export type FreeeReadErrorKind = "forbidden" | "unauthorized" | "not_found" | "rate_limited" | "too_many_pages" | "other";

export class FreeeReadError extends Error {
  constructor(
    readonly source: string,
    readonly kind: FreeeReadErrorKind,
    readonly status: number | null
  ) {
    // レスポンス本文は事業所の実データを含み得るため、出所・種類・ステータスだけを持つ
    super(`freeeの読み取りに失敗しました(${source}: ${kind}${status === null ? "" : `, status=${status}`})`);
    this.name = "FreeeReadError";
  }
}

function kindOf(status: number): FreeeReadErrorKind {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  return "other";
}

export type FetchLike = (url: string, init: { headers: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export interface ForecastClientDeps {
  fetch?: FetchLike;
  getToken?: () => Promise<string>;
}

async function freeeRead<T>(
  source: string,
  baseUrl: string,
  path: string,
  params: Record<string, string | number | undefined>,
  deps: ForecastClientDeps
): Promise<T> {
  const token = await (deps.getToken ?? getValidFreeeAccessToken)();
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined) query.set(key, String(value));
  const doFetch = deps.fetch ?? (fetch as unknown as FetchLike);
  const res = await doFetch(`${baseUrl}${path}?${query.toString()}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new FreeeReadError(source, kindOf(res.status), res.status);
  return (await res.json()) as T;
}

async function readAllPages<T>(source: string, read: (offset: number) => Promise<T[]>): Promise<T[]> {
  const all: T[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const rows = await read(page * PAGE_LIMIT);
    all.push(...rows);
    if (rows.length < PAGE_LIMIT) return all;
  }
  throw new FreeeReadError(source, "too_many_pages", null);
}

// ---------------------------------------------------------------------------
// 勘定科目

interface RawAccountItem {
  id: number;
  name: string;
}

export async function listAccountItemNames(companyId: number, deps: ForecastClientDeps = {}): Promise<Map<number, string>> {
  const data = await freeeRead<{ account_items: RawAccountItem[] }>("account_items", ACCOUNTING_BASE_URL, "/api/1/account_items", { company_id: companyId }, deps);
  return new Map(data.account_items.map((a) => [a.id, a.name]));
}

// ---------------------------------------------------------------------------
// 取引

export interface ForecastDealDetail {
  accountName: string;
  amount: number;
}

export interface ForecastDealPayment {
  date: string;
  amount: number;
  walletableType: string | null;
  walletableId: number | null;
}

export interface ForecastDeal {
  id: number;
  type: "income" | "expense";
  issueDate: string;
  dueDate: string | null;
  amount: number;
  /** 未決済額(freeeのdue_amount)。決済済みは0 */
  dueAmount: number;
  status: "settled" | "unsettled";
  partnerId: number | null;
  details: ForecastDealDetail[];
  payments: ForecastDealPayment[];
}

interface RawDeal {
  id: number;
  type: "income" | "expense";
  issue_date: string;
  due_date?: string | null;
  amount: number;
  due_amount?: number;
  status: "settled" | "unsettled";
  partner_id?: number | null;
  details?: { account_item_id: number; amount: number }[];
  payments?: { date: string; amount: number; from_walletable_type?: string | null; from_walletable_id?: number | null }[];
}

export function toForecastDeal(raw: RawDeal, accountNames: Map<number, string>): ForecastDeal {
  return {
    id: raw.id,
    type: raw.type,
    issueDate: raw.issue_date,
    dueDate: raw.due_date ?? null,
    amount: raw.amount,
    dueAmount: raw.due_amount ?? 0,
    status: raw.status,
    partnerId: raw.partner_id ?? null,
    // 科目名が引けない明細は空文字にする(分類側で「その他」へ寄せ、推測で既知の科目にしない)
    details: (raw.details ?? []).map((d) => ({ accountName: accountNames.get(d.account_item_id) ?? "", amount: d.amount })),
    payments: (raw.payments ?? []).map((p) => ({
      date: p.date,
      amount: p.amount,
      walletableType: p.from_walletable_type ?? null,
      walletableId: p.from_walletable_id ?? null,
    })),
  };
}

export interface ListDealsQuery {
  type?: "income" | "expense";
  status?: "settled" | "unsettled";
  startIssueDate?: string;
  endIssueDate?: string;
}

export async function listDeals(
  companyId: number,
  query: ListDealsQuery,
  accountNames: Map<number, string>,
  deps: ForecastClientDeps = {}
): Promise<ForecastDeal[]> {
  const raws = await readAllPages("deals", async (offset) => {
    const data = await freeeRead<{ deals: RawDeal[] }>(
      "deals",
      ACCOUNTING_BASE_URL,
      "/api/1/deals",
      {
        company_id: companyId,
        type: query.type,
        status: query.status,
        start_issue_date: query.startIssueDate,
        end_issue_date: query.endIssueDate,
        limit: PAGE_LIMIT,
        offset,
      },
      deps
    );
    return data.deals;
  });
  return raws.map((r) => toForecastDeal(r, accountNames));
}

// ---------------------------------------------------------------------------
// 給与明細・賞与明細(人事労務)

export interface PayrollMonth {
  kind: "salary" | "bonus";
  /** 支給年月(YYYY-MM) */
  month: string;
  /** 差引支給額の合計 */
  netTotal: number;
  /** 最も多い支給日 */
  payDate: string;
  statementCount: number;
  /** 確定済みの明細の件数(fixed=true) */
  fixedCount: number;
}

interface RawPayrollStatement {
  pay_date: string;
  net_payment_amount: string | number | null;
  fixed?: boolean;
}

/** 指定月の給与/賞与明細の合計。明細が無い月(freeeは404を返す)はnull */
export async function getPayrollMonth(
  companyId: number,
  kind: "salary" | "bonus",
  year: number,
  month: number,
  deps: ForecastClientDeps = {}
): Promise<PayrollMonth | null> {
  const path = kind === "salary" ? "/api/v1/salaries/employee_payroll_statements" : "/api/v1/bonuses/employee_payroll_statements";
  const source = kind === "salary" ? "salary_statements" : "bonus_statements";
  let statements: RawPayrollStatement[];
  try {
    statements = await readAllPages(source, async (offset) => {
      const data = await freeeRead<{ employee_payroll_statements?: RawPayrollStatement[] }>(
        source,
        HR_BASE_URL,
        path,
        { company_id: companyId, year, month, limit: PAGE_LIMIT, offset },
        deps
      );
      return data.employee_payroll_statements ?? [];
    });
  } catch (error) {
    if (error instanceof FreeeReadError && error.kind === "not_found") return null;
    throw error;
  }
  if (statements.length === 0) return null;
  const payDates = new Map<string, number>();
  for (const s of statements) payDates.set(s.pay_date, (payDates.get(s.pay_date) ?? 0) + 1);
  const payDate = [...payDates.entries()].sort((a, b) => b[1] - a[1])[0][0];
  return {
    kind,
    month: `${year}-${String(month).padStart(2, "0")}`,
    netTotal: statements.reduce((sum, s) => sum + Math.round(Number(s.net_payment_amount ?? 0)), 0),
    payDate,
    statementCount: statements.length,
    fixedCount: statements.filter((s) => s.fixed === true).length,
  };
}

// ---------------------------------------------------------------------------
// 口座間の振替・口座明細・口座

export interface ForecastTransfer {
  date: string;
  amount: number;
  fromWalletableId: number;
  toWalletableId: number;
}

export async function listTransfers(companyId: number, startDate: string, endDate: string, deps: ForecastClientDeps = {}): Promise<ForecastTransfer[]> {
  return readAllPages("transfers", async (offset) => {
    const data = await freeeRead<{ transfers: { date: string; amount: number; from_walletable_id: number; to_walletable_id: number }[] }>(
      "transfers",
      ACCOUNTING_BASE_URL,
      "/api/1/transfers",
      { company_id: companyId, start_date: startDate, end_date: endDate, limit: PAGE_LIMIT, offset },
      deps
    );
    return data.transfers.map((t) => ({ date: t.date, amount: t.amount, fromWalletableId: t.from_walletable_id, toWalletableId: t.to_walletable_id }));
  });
}

export interface ForecastWalletTxn {
  date: string;
  entrySide: "income" | "expense";
  amount: number;
  /** 未消込額 */
  dueAmount: number;
  /** freeeの明細ステータス(1=未処理) */
  status: number;
  walletableType: string;
  walletableId: number;
}

export async function listWalletTxns(companyId: number, startDate: string, endDate: string, deps: ForecastClientDeps = {}): Promise<ForecastWalletTxn[]> {
  return readAllPages("wallet_txns", async (offset) => {
    const data = await freeeRead<{
      wallet_txns: { date: string; entry_side: "income" | "expense"; amount: number; due_amount?: number; status: number; walletable_type: string; walletable_id: number }[];
    }>("wallet_txns", ACCOUNTING_BASE_URL, "/api/1/wallet_txns", { company_id: companyId, start_date: startDate, end_date: endDate, limit: PAGE_LIMIT, offset }, deps);
    return data.wallet_txns.map((t) => ({
      date: t.date,
      entrySide: t.entry_side,
      amount: t.amount,
      dueAmount: t.due_amount ?? 0,
      status: t.status,
      walletableType: t.walletable_type,
      walletableId: t.walletable_id,
    }));
  });
}

export interface ForecastWalletable {
  id: number;
  name: string;
  type: string;
  /** 銀行と最後に同期した日(YYYY-MM-DD)。同期したことが無ければnull */
  lastSyncDate: string | null;
}

export async function listWalletables(companyId: number, deps: ForecastClientDeps = {}): Promise<ForecastWalletable[]> {
  const data = await freeeRead<{ walletables: { id: number; name: string; type: string; update_date?: string | null }[] }>(
    "walletables",
    ACCOUNTING_BASE_URL,
    "/api/1/walletables",
    { company_id: companyId, with_balance: "true" },
    deps
  );
  return data.walletables.map((w) => ({ id: w.id, name: w.name, type: w.type, lastSyncDate: w.update_date ?? null }));
}

// ---------------------------------------------------------------------------
// 月末時点の科目残高(一時的な納付の根拠にする負債科目)

/**
 * 指定月末時点の科目残高。科目の行が無い場合は0(freeeは残高・動きゼロの科目行を省略する)。
 * fiscalYearはfreeeの会計年度(期首の西暦年)、monthは暦月。
 */
export async function getMonthEndAccountBalances(
  companyId: number,
  fiscalYear: number,
  month: number,
  accountNames: string[],
  deps: ForecastClientDeps = {}
): Promise<Record<string, number>> {
  const data = await freeeRead<{ trial_bs: { balances: { account_item_name?: string; closing_balance: number }[] } }>(
    "trial_bs",
    ACCOUNTING_BASE_URL,
    "/api/1/reports/trial_bs",
    { company_id: companyId, fiscal_year: fiscalYear, start_month: month, end_month: month },
    deps
  );
  return Object.fromEntries(
    accountNames.map((name) => [name, data.trial_bs.balances.find((b) => b.account_item_name === name)?.closing_balance ?? 0])
  );
}
