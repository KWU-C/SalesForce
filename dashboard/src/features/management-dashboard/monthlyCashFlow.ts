import { getTrialBs } from "@/services/freee/freeeAccountingClient";
import {
  getAccountItems,
  getExpenseDeals,
  getTransfers,
  getWalletTxns,
  getWalletables,
} from "@/services/freee/freeeTransactionClient";
import type { FreeeDeal } from "@/services/freee/freeeTransactionClient";
import { classifyExpenseAccountItem } from "@/config/freeeExpenseClassification";
import type { ExpenseCategory } from "@/config/freeeExpenseClassification";
import type { MonthlyCashFlow } from "./types";

const EMPTY_CATEGORY_TOTALS: Record<ExpenseCategory, number> = {
  labor: 0,
  outsourcing: 0,
  taxSocial: 0,
  financing: 0,
  assetTransfer: 0,
  otherOperating: 0,
  other: 0,
};

/** 暦月(1-12)の月初日・月末日(yyyy-mm-dd)。fiscalYearはfreeeのfiscal_year(期首の西暦年) */
function monthDateRange(fiscalYear: number, calendarMonth: number): { start: string; end: string } {
  const calendarYear = calendarMonth >= 9 ? fiscalYear : fiscalYear + 1;
  const start = new Date(Date.UTC(calendarYear, calendarMonth - 1, 1));
  const end = new Date(Date.UTC(calendarYear, calendarMonth, 0));
  const toDateOnly = (d: Date) => d.toISOString().slice(0, 10);
  return { start: toDateOnly(start), end: toDateOnly(end) };
}

/** dealsの発生日を対象月より広めに遡って取得する幅(月数)。決済が発生日から数ヶ月遅れるケースをカバーする */
const ISSUE_DATE_LOOKBACK_MONTHS = 4;

function subtractMonths(dateStr: string, months: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

/**
 * dealの明細のうち最も金額の大きい行の勘定科目で、取引全体を代表分類する
 * (1取引=1区分。二重計上を避けるための方針、実データ検証済み)。
 */
function representativeCategory(deal: FreeeDeal, idToName: Map<number, string>): ExpenseCategory {
  if (deal.details.length === 0) return "other";
  const mainDetail = deal.details.reduce((a, b) => (Math.abs(b.amount) > Math.abs(a.amount) ? b : a));
  const name = idToName.get(mainDetail.account_item_id) ?? "";
  return classifyExpenseAccountItem(name);
}

/**
 * 指定月の資金収支(会社版家計簿)をfreeeの実データから再構成する。
 *
 * 手法(2026年8月の実データで検証済み):
 * - 外部入金・外部支出は wallet_txns(銀行/wallet口座のみ、カード種別除く)から算出し、
 *   transfers(自社口座間振替)の合計を両側から差し引く
 * - 支出の区分内訳は、個々のwallet_txnとdealを1件ずつ突合するのではなく、
 *   dealsのpayments(決済)のうち対象月に決済されたものを区分ごとに合算する
 *   (1件ずつの突合はdeal側の決済日とwallet_txn側の記帳日がずれるケースがあり
 *   信頼できなかったため、集計レベルでの比較に変更。検証の結果、区分別合計は
 *   外部支出総額の約101.7%を説明でき、実用的な精度と判断)
 * - 月初・月末現預金はtrial_bsの現金・預金科目群(opening/closing_balance)から算出
 */
export async function computeMonthlyCashFlow(
  companyId: number,
  fiscalYear: number,
  calendarMonth: number
): Promise<Omit<MonthlyCashFlow, "fiscalYear" | "month" | "fetchedAt">> {
  const { start, end } = monthDateRange(fiscalYear, calendarMonth);
  const wideStart = subtractMonths(start, ISSUE_DATE_LOOKBACK_MONTHS);

  const [walletTxns, transfers, trialBs, accountItems, walletables, expenseDeals] = await Promise.all([
    getWalletTxns(companyId, start, end),
    getTransfers(companyId, start, end),
    getTrialBs(companyId, { fiscalYear, startMonth: calendarMonth, endMonth: calendarMonth }),
    getAccountItems(companyId),
    getWalletables(companyId),
    getExpenseDeals(companyId, wideStart, end),
  ]);

  const idToName = new Map(accountItems.map((i) => [i.id, i.name]));
  const cashWalletableIds = new Set(
    walletables.filter((w) => w.type === "bank_account" || w.type === "wallet").map((w) => w.id)
  );

  const cashTxns = walletTxns.filter((w) => cashWalletableIds.has(w.walletable_id));
  const grossIncome = cashTxns.filter((w) => w.entry_side === "income").reduce((s, w) => s + w.amount, 0);
  const grossExpense = cashTxns.filter((w) => w.entry_side === "expense").reduce((s, w) => s + w.amount, 0);
  const transferTotal = transfers.reduce((s, t) => s + t.amount, 0);
  const externalIncome = grossIncome - transferTotal;
  const externalExpenseTotal = grossExpense - transferTotal;

  const expenseByCategory: Record<ExpenseCategory, number> = { ...EMPTY_CATEGORY_TOTALS };
  for (const deal of expenseDeals) {
    for (const payment of deal.payments) {
      if (payment.date < start || payment.date > end) continue;
      if (payment.from_walletable_id === null || !cashWalletableIds.has(payment.from_walletable_id)) continue;
      const category = representativeCategory(deal, idToName);
      expenseByCategory[category] += payment.amount;
    }
  }

  const operatingExpense =
    expenseByCategory.labor +
    expenseByCategory.outsourcing +
    expenseByCategory.taxSocial +
    expenseByCategory.otherOperating +
    expenseByCategory.other;

  const cashLeaves = trialBs.balances.filter(
    (b) => b.account_category_name === "現金・預金" && !!b.account_item_name
  );
  const cashOpening = cashLeaves.length > 0 ? cashLeaves.reduce((s, b) => s + b.opening_balance, 0) : null;
  const cashClosing = cashLeaves.length > 0 ? cashLeaves.reduce((s, b) => s + b.closing_balance, 0) : null;

  return {
    cashOpening,
    cashClosing,
    cashChange: cashOpening !== null && cashClosing !== null ? cashClosing - cashOpening : null,
    externalIncome,
    externalExpenseTotal,
    expenseByCategory,
    operatingCashFlow: externalIncome - operatingExpense,
    financingCashFlow: -expenseByCategory.financing,
    assetTransferCashFlow: -expenseByCategory.assetTransfer,
  };
}
