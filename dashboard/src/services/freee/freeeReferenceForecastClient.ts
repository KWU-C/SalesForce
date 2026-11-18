import {
  ACCOUNTING_BASE_URL,
  FreeeReadError,
  freeeRead,
  HR_BASE_URL,
  PAGE_LIMIT,
  readAllPages,
  type ForecastClientDeps,
} from "./freeeForecastClient";

/**
 * 資金・損益の参考予測(DEVの再計算、2026-11-18)のためのfreee読み取り。すべてGETのみ。
 * scripts/reference-forecast(Python、手動計算)が読んでいたものと同じ範囲を読む。
 * 取引先名は入金照合(Salesforceとの突き合わせ)の計算にだけ使い、記録には残さない。
 */

export interface RfAccountItem {
  id: number;
  name: string;
  category: string;
  walletableId: number | null;
}

export async function listRfAccountItems(companyId: number, deps: ForecastClientDeps = {}): Promise<RfAccountItem[]> {
  const data = await freeeRead<{ account_items: { id: number; name: string; account_category?: string; walletable_id?: number | null }[] }>(
    "account_items",
    ACCOUNTING_BASE_URL,
    "/api/1/account_items",
    { company_id: companyId },
    deps
  );
  return data.account_items.map((a) => ({ id: a.id, name: a.name, category: a.account_category ?? "", walletableId: a.walletable_id ?? null }));
}

export async function listRfPartners(companyId: number, deps: ForecastClientDeps = {}): Promise<Map<number, string>> {
  const rows = await readAllPages("partners", async (offset) => {
    const data = await freeeRead<{ partners: { id: number; name: string }[] }>(
      "partners",
      ACCOUNTING_BASE_URL,
      "/api/1/partners",
      { company_id: companyId, limit: PAGE_LIMIT, offset },
      deps
    );
    return data.partners;
  });
  return new Map(rows.map((p) => [p.id, p.name]));
}

export interface RfWalletTxn {
  id: number;
  date: string;
  entrySide: "income" | "expense";
  amount: number;
  description: string;
  walletableType: string;
  walletableId: number;
  status: number;
}

export async function listRfWalletTxns(companyId: number, startDate: string, endDate: string, deps: ForecastClientDeps = {}): Promise<RfWalletTxn[]> {
  return readAllPages("wallet_txns", async (offset) => {
    const data = await freeeRead<{
      wallet_txns: {
        id: number;
        date: string;
        entry_side: "income" | "expense";
        amount: number;
        description?: string | null;
        walletable_type: string;
        walletable_id: number;
        status: number;
      }[];
    }>("wallet_txns", ACCOUNTING_BASE_URL, "/api/1/wallet_txns", { company_id: companyId, start_date: startDate, end_date: endDate, limit: PAGE_LIMIT, offset }, deps);
    return data.wallet_txns.map((t) => ({
      id: t.id,
      date: t.date,
      entrySide: t.entry_side,
      amount: t.amount,
      description: t.description ?? "",
      walletableType: t.walletable_type,
      walletableId: t.walletable_id,
      status: t.status,
    }));
  });
}

export interface RfTransfer {
  date: string;
  amount: number;
  fromWalletableId: number;
  toWalletableId: number;
}

export async function listRfTransfers(companyId: number, startDate: string, endDate: string, deps: ForecastClientDeps = {}): Promise<RfTransfer[]> {
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

export interface RfWalletable {
  id: number;
  name: string;
  type: string;
  /** freeeの口座の最終更新日(銀行との同期日の目安) */
  updateDate: string | null;
}

export async function listRfWalletables(companyId: number, deps: ForecastClientDeps = {}): Promise<RfWalletable[]> {
  const data = await freeeRead<{ walletables: { id: number; name: string; type: string; update_date?: string | null }[] }>(
    "walletables",
    ACCOUNTING_BASE_URL,
    "/api/1/walletables",
    { company_id: companyId },
    deps
  );
  return data.walletables.map((w) => ({ id: w.id, name: w.name, type: w.type, updateDate: w.update_date ?? null }));
}

export interface RfDeal {
  id: number;
  type: "income" | "expense";
  issueDate: string;
  dueDate: string | null;
  amount: number;
  dueAmount: number;
  partnerId: number | null;
  details: { accountName: string; amount: number; description: string }[];
  payments: { date: string; amount: number; walletableType: string | null; walletableId: number | null }[];
}

interface RawRfDeal {
  id: number;
  type: "income" | "expense";
  issue_date: string;
  due_date?: string | null;
  amount: number;
  due_amount?: number;
  partner_id?: number | null;
  details?: { account_item_id: number; amount: number; description?: string | null }[];
  payments?: { date: string; amount: number; from_walletable_type?: string | null; from_walletable_id?: number | null }[];
}

export async function listRfDeals(
  companyId: number,
  query: { type: "income" | "expense"; startIssueDate?: string; endIssueDate?: string; accountItemId?: number },
  accountNames: Map<number, string>,
  deps: ForecastClientDeps = {}
): Promise<RfDeal[]> {
  const raws = await readAllPages("deals", async (offset) => {
    const data = await freeeRead<{ deals: RawRfDeal[] }>(
      "deals",
      ACCOUNTING_BASE_URL,
      "/api/1/deals",
      {
        company_id: companyId,
        type: query.type,
        start_issue_date: query.startIssueDate,
        end_issue_date: query.endIssueDate,
        account_item_id: query.accountItemId,
        limit: PAGE_LIMIT,
        offset,
      },
      deps
    );
    return data.deals;
  });
  return raws.map((r) => ({
    id: r.id,
    type: r.type,
    issueDate: r.issue_date,
    dueDate: r.due_date ?? null,
    amount: r.amount,
    dueAmount: r.due_amount ?? 0,
    partnerId: r.partner_id ?? null,
    details: (r.details ?? []).map((d) => ({ accountName: accountNames.get(d.account_item_id) ?? "", amount: d.amount, description: d.description ?? "" })),
    payments: (r.payments ?? []).map((p) => ({
      date: p.date,
      amount: p.amount,
      walletableType: p.from_walletable_type ?? null,
      walletableId: p.from_walletable_id ?? null,
    })),
  }));
}

export interface RfManualJournal {
  issueDate: string;
  details: { accountName: string; entrySide: "debit" | "credit"; amount: number; description: string }[];
}

export async function listRfManualJournals(
  companyId: number,
  query: { startIssueDate: string; endIssueDate?: string; accountItemId?: number },
  accountNames: Map<number, string>,
  deps: ForecastClientDeps = {}
): Promise<RfManualJournal[]> {
  const raws = await readAllPages("manual_journals", async (offset) => {
    const data = await freeeRead<{
      manual_journals: { issue_date: string; details: { account_item_id: number; entry_side: "debit" | "credit"; amount: number; description?: string | null }[] }[];
    }>(
      "manual_journals",
      ACCOUNTING_BASE_URL,
      "/api/1/manual_journals",
      {
        company_id: companyId,
        start_issue_date: query.startIssueDate,
        end_issue_date: query.endIssueDate,
        account_item_id: query.accountItemId,
        limit: PAGE_LIMIT,
        offset,
      },
      deps
    );
    return data.manual_journals;
  });
  return raws.map((j) => ({
    issueDate: j.issue_date,
    details: j.details.map((d) => ({
      accountName: accountNames.get(d.account_item_id) ?? "",
      entrySide: d.entry_side,
      amount: d.amount,
      description: d.description ?? "",
    })),
  }));
}

export interface RfTrialBsRow {
  accountName: string;
  categoryName: string;
  closing: number;
  items: { name: string; closing: number }[];
}

/** 試算表(貸借対照表)。range: 日付指定(start/end)か、会計年度の期首月〜指定月 */
export async function getRfTrialBs(
  companyId: number,
  range: { startDate: string; endDate: string } | { fiscalYear: number; endMonth: number },
  withItems: boolean,
  deps: ForecastClientDeps = {}
): Promise<RfTrialBsRow[]> {
  const params: Record<string, string | number | undefined> = { company_id: companyId };
  if ("startDate" in range) {
    params.start_date = range.startDate;
    params.end_date = range.endDate;
  } else {
    params.fiscal_year = range.fiscalYear;
    params.start_month = 9;
    params.end_month = range.endMonth;
  }
  if (withItems) params.breakdown_display_type = "item";
  const data = await freeeRead<{
    trial_bs: {
      balances: {
        account_item_name?: string;
        account_category_name?: string;
        closing_balance?: number;
        items?: { name?: string; closing_balance?: number }[];
      }[];
    };
  }>("trial_bs", ACCOUNTING_BASE_URL, "/api/1/reports/trial_bs", params, deps);
  return data.trial_bs.balances
    .filter((b) => b.account_item_name)
    .map((b) => ({
      accountName: b.account_item_name ?? "",
      categoryName: b.account_category_name ?? "",
      closing: b.closing_balance ?? 0,
      items: (b.items ?? []).map((i) => ({ name: i.name ?? "", closing: i.closing_balance ?? 0 })),
    }));
}

/** 給与明細の月合計(人事労務)。明細の無い月はnull */
export interface RfPayrollMonth {
  count: number;
  fixed: number;
  transfer: number;
  expense: number;
  calculatedAt: string;
  workedZero: number;
  payDate: string;
}

/** 賞与明細の月合計 */
export interface RfBonusMonth {
  count: number;
  fixed: number;
  gross: number;
  deductions: number;
  net: number;
  payDate: string;
}

async function hrStatements(
  companyId: number,
  kind: "salaries" | "bonuses",
  ym: string,
  deps: ForecastClientDeps
): Promise<Record<string, unknown>[] | null> {
  const source = kind === "salaries" ? "salary_statements" : "bonus_statements";
  try {
    const rows = await readAllPages(source, async (offset) => {
      const data = await freeeRead<{ employee_payroll_statements?: Record<string, unknown>[] }>(
        source,
        HR_BASE_URL,
        `/api/v1/${kind}/employee_payroll_statements`,
        { company_id: companyId, year: Number(ym.slice(0, 4)), month: Number(ym.slice(5, 7)), limit: PAGE_LIMIT, offset },
        deps
      );
      return data.employee_payroll_statements ?? [];
    });
    return rows.length === 0 ? null : rows;
  } catch (error) {
    if (error instanceof FreeeReadError && error.kind === "not_found") return null;
    throw error;
  }
}

const num = (v: unknown) => Math.trunc(Number(v ?? 0) || 0);

function mostCommon(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
}

export async function getRfPayrollMonth(companyId: number, ym: string, deps: ForecastClientDeps = {}): Promise<RfPayrollMonth | null> {
  const rows = await hrStatements(companyId, "salaries", ym, deps);
  if (!rows) return null;
  return {
    count: rows.length,
    fixed: rows.filter((r) => r.fixed === true).length,
    transfer: rows.reduce((s, r) => s + num(r.total_transfer_amount), 0),
    expense: rows.reduce((s, r) => s + num(r.total_expense_amount), 0),
    calculatedAt: rows.map((r) => String(r.calculated_at ?? "").slice(0, 10)).sort().at(-1) ?? "",
    workedZero: rows.filter((r) => Number(r.total_worked_days_count ?? 0) === 0).length,
    payDate: mostCommon(rows.map((r) => String(r.pay_date ?? ""))),
  };
}

export async function getRfBonusMonth(companyId: number, ym: string, deps: ForecastClientDeps = {}): Promise<RfBonusMonth | null> {
  const rows = await hrStatements(companyId, "bonuses", ym, deps);
  if (!rows) return null;
  return {
    count: rows.length,
    fixed: rows.filter((r) => r.fixed === true).length,
    gross: rows.reduce((s, r) => s + num(r.gross_payment_amount), 0),
    deductions: rows.reduce((s, r) => s + num(r.total_deduction_amount), 0),
    net: rows.reduce((s, r) => s + num(r.net_payment_amount), 0),
    payDate: mostCommon(rows.map((r) => String(r.pay_date ?? ""))),
  };
}
