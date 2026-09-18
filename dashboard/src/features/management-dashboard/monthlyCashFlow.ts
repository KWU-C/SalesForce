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
import { isCashWalletable } from "@/config/cashAccountBoundary";
import { computeExternalCashFlow } from "./externalCashFlow";
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
 * 手法(2026-09-18改訂。output/freee49-audit/REPORT.md(通称Codexレポート)による
 * 監査を踏まえた恒久ロジック):
 * - 外部入金・外部支出は wallet_txns(口座境界はcashAccountBoundary.ts。bank_account型は
 *   常時対象、wallet型はallowlistに載ったもののみ対象。カード種別は対象外)から算出し、
 *   externalCashFlow.ts(computeExternalCashFlow)で以下を控除する。
 *   1. 公式transfers(自社口座間振替)。ただしincome側はtransfer.to_walletables[].amount
 *      (受取先の実額、手数料控除後)、expense側はtransfer.amount(送金元の額面)で、
 *      それぞれ(date, walletable, amount)の1:1消費マッチングにより照合する
 *      (2026-09-15時点の「一律控除」は、振替先がカード等でwallet_txnsが生成されない
 *      ケースを歪めることが判明したため廃止。片側マッチングへの単純な置き換えも
 *      実データ検証でtrial_bs差額が悪化したため、実額照合の精度を上げる方向で解決)。
 *   2. externalCashFlowOverrides.tsの証拠付きoverride(confidence=confirmedのみ)。
 *      freeeのtransfers APIに登録されていない非公式な内部振替を、仕訳(manual_journals)
 *      の貸借照合で1件ずつ裏取りした個別レコードとして適用する。ハードコードの定数では
 *      なく、ID・根拠・confidence付きのレコードとして保持し、恒久ロジックと明確に分離する。
 *   未解決の明細(evidence不十分なもの)はoverride化せず、controlされたunresolvedItems/
 *   tentativeCandidatesとして結果に残す(無理に分類・補正しない、ユーザー確定2026-09-18)。
 *   このためexternalIncome/externalExpenseTotalは「恒久ロジック＋確定overrideまでの
 *   算出値」であり、未解決分を含む可能性がある点に注意(status="provisional"で判別可能)。
 * - 支出の区分内訳は、個々のwallet_txnとdealを1件ずつ突合するのではなく、
 *   dealsのpayments(決済)のうち対象月に決済されたものを区分ごとに合算する
 *   (1件ずつの突合はdeal側の決済日とwallet_txn側の記帳日がずれるケースがあり
 *   信頼できなかったため、集計レベルでの比較に変更。検証の結果、区分別合計は
 *   外部支出総額の約101.7%を説明でき、実用的な精度と判断)
 * - 区分分類の対象walletableは現金・預金+クレジットカード(categorizableWalletableIds)。
 *   一方、外部入金・外部支出(wallet_txnsベース)は現金・預金のみ(cashWalletableIds)と
 *   意図的に非対称(2026-09-15修正)。カード利用はwallet_txnsを生成しないため後者には
 *   含められないが、dealとしては現金払いと同じ情報を持つため区分分類には含める。
 *   これにより、以前は「カード利用時は区分から除外され、銀行→カード引落もtransfersとして
 *   内部振替扱いになり、実支出がどの区分にも一度も計上されない」問題があったが解消した。
 *   銀行→カード引落はdeal/paymentではなくtransfersなので、ここでの二重計上にはならない
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
  // 支出の区分分類(expenseByCategory)は、現金・預金(cashAccountBoundary)に加えて
  // クレジットカード払いのdealも対象にする(2026-09-15修正)。カード利用時はwallet_txnsを
  // 生成しないため外部入金・外部支出(wallet_txnsベース)には含められないが、deal自体は
  // 通常の現金払いと同じ明細情報を持つため、同じ代表科目分類で人件費/外注費/税金社会保険等/
  // 諸経費/その他へ計上できる。銀行口座からカード会社への引落はtransfersであり
  // deal/paymentではないため、ここでの分類対象には含まれない(二重計上にならない)
  const categorizableWalletableIds = new Set(
    walletables.filter((w) => isCashWalletable(w) || w.type === "credit_card").map((w) => w.id)
  );

  const cashTxns = walletTxns.filter((w) => isCashWalletable({ type: w.walletable_type, id: w.walletable_id }));
  const cashIncome = cashTxns.filter((w) => w.entry_side === "income");
  const cashExpense = cashTxns.filter((w) => w.entry_side === "expense");
  const externalCashFlow = computeExternalCashFlow(companyId, cashIncome, cashExpense, transfers);
  const { externalIncome, externalExpenseTotal } = externalCashFlow;

  const expenseByCategory: Record<ExpenseCategory, number> = { ...EMPTY_CATEGORY_TOTALS };
  for (const deal of expenseDeals) {
    // 未決済(status=unsettled)のdealはpaymentsキー自体が存在しないことがある(実データで確認)
    for (const payment of deal.payments ?? []) {
      if (payment.date < start || payment.date > end) continue;
      if (payment.from_walletable_id === null || !categorizableWalletableIds.has(payment.from_walletable_id)) continue;
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
    calculationVersion: externalCashFlow.calculationVersion,
    status: externalCashFlow.status,
    appliedOverrideIds: externalCashFlow.appliedOverrideIds,
    unresolvedItems: externalCashFlow.unresolvedItems,
    tentativeCandidates: externalCashFlow.tentativeCandidates,
    expenseByCategory,
    operatingCashFlow: externalIncome - operatingExpense,
    /** 借入元本返済のみ(利息は含まない、ユーザー確定2026-09-15。借入状況の今期返済と同じ「元本」の定義) */
    financingCashFlow: -expenseByCategory.financing,
    /** 当月支払利息。借入コストとして元本返済とは別枠 */
    interestCashFlow: -expenseByCategory.interest,
    assetTransferCashFlow: -expenseByCategory.assetTransfer,
  };
}
