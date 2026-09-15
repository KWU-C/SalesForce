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
  interest: 0,
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
 * 借入返済dealは、1つのdeal内に借入金(元本)と支払利息が別明細行で計上され、
 * 金額の大きい元本行が代表科目に選ばれる(実データ確認済み、2026-09-15)。
 * これをそのまま「financing」1区分に計上すると、借入残高の減少(元本)と
 * 借入コスト(利息)が区別できなくなるため、dealの明細行の金額比で
 * payment.amountをfinancing(元本)とinterest(利息)に按分する。
 * 利息行が無い通常の借入金dealはfinancingへ全額計上(従来通り)。
 * 実データ検証: 5件の返済dealで元本明細の合計・利息明細の合計がそれぞれ
 * payment.amountの合計と1円単位で一致することを確認済み。
 */
function splitLoanRepaymentPayment(
  deal: FreeeDeal,
  paymentAmount: number,
  idToName: Map<number, string>
): { financing: number; interest: number } {
  let principalTotal = 0;
  let interestTotal = 0;
  for (const detail of deal.details) {
    const name = idToName.get(detail.account_item_id) ?? "";
    const category = classifyExpenseAccountItem(name);
    if (category === "financing") principalTotal += Math.abs(detail.amount);
    else if (category === "interest") interestTotal += Math.abs(detail.amount);
  }
  const lineTotal = principalTotal + interestTotal;
  if (lineTotal === 0) return { financing: paymentAmount, interest: 0 };

  const financingShare = Math.round((paymentAmount * principalTotal) / lineTotal);
  return { financing: financingShare, interest: paymentAmount - financingShare };
}

/**
 * 指定月の資金収支(会社版家計簿)をfreeeの実データから再構成する。
 *
 * 手法(2026年8月の実データで検証済み):
 * - 外部入金・外部支出は wallet_txns(銀行/wallet口座のみ、カード種別除く)から算出し、
 *   transfers(自社口座間振替)の合計を両側から一律に差し引く。
 *
 *   【既知の限界、2026-09-15検証】振替先がクレジットカードやwallet型口座の場合、
 *   その側にはwallet_txnsが生成されないケースがあり、この一律控除は外部入金・外部支出を
 *   個別には歪める(実データで9月に約99万円分を確認)。日付・金額ベースの片側マッチングへの
 *   修正を試みたが、実データ検証の結果、trial_bs実績との差額(調整・未分類差額)がかえって
 *   拡大した(片側の対応関係が完全には再現できないマッチングノイズが乗るため)。
 *   より再現性のある方法(transfer ID・口座種別・journalとの関連付け等)を別途設計するまでは、
 *   この一律控除を暫定実装として維持する(ユーザー確定、2026-09-15。「正しい仕様」として
 *   確定したものではない)。
 *
 *   なお、外部入金-外部支出の【差】自体はこの控除方法に依存しない(同額を両側から
 *   引くため計算上完全に相殺する)。月末現預金の真値はtrial_bs(canonical)を使うため、
 *   この限界は「調整・未分類差額」に自動的に反映され、他区分へ紛れ込むことはない。
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
    // 未決済(status=unsettled)のdealはpaymentsキー自体が存在しないことがある(実データで確認)
    for (const payment of deal.payments ?? []) {
      if (payment.date < start || payment.date > end) continue;
      if (payment.from_walletable_id === null || !cashWalletableIds.has(payment.from_walletable_id)) continue;
      const category = representativeCategory(deal, idToName);
      if (category === "financing" || category === "interest") {
        const { financing, interest } = splitLoanRepaymentPayment(deal, payment.amount, idToName);
        expenseByCategory.financing += financing;
        expenseByCategory.interest += interest;
      } else {
        expenseByCategory[category] += payment.amount;
      }
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
    /** 借入元本返済のみ(利息は含まない、ユーザー確定2026-09-15。借入状況の今期返済と同じ「元本」の定義) */
    financingCashFlow: -expenseByCategory.financing,
    /** 当月支払利息。借入コストとして元本返済とは別枠 */
    interestCashFlow: -expenseByCategory.interest,
    assetTransferCashFlow: -expenseByCategory.assetTransfer,
  };
}
