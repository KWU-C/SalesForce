import { getTrialBs } from "@/services/freee/freeeAccountingClient";
import { getAccountItems, getWalletTxns, getWalletables } from "@/services/freee/freeeTransactionClient";
import { getJournalsCsv } from "@/services/freee/freeeJournalsClient";
import { OPERATING_CATEGORIES } from "@/config/freeeExpenseClassification";
import type { ExpenseCategory } from "@/config/freeeExpenseClassification";
import { isCashWalletable } from "@/config/cashAccountBoundary";
import { EXTERNAL_CASH_FLOW_CALCULATION_VERSION } from "./externalCashFlow";
import type { ExternalCashFlowStatus } from "./externalCashFlow";
import { computeJournalCashFlow } from "./journalCashFlow";
import { journalExportRange, parseJournalCsv } from "./journalCsv";
import type { JournalGroup } from "./journalCsv";
import type { MonthlyCashFlow } from "./types";

/** 暦月(1-12)の月初日・月末日(yyyy-mm-dd)。fiscalYearはfreeeのfiscal_year(期首の西暦年) */
function monthDateRange(fiscalYear: number, calendarMonth: number): { start: string; end: string } {
  const calendarYear = calendarMonth >= 9 ? fiscalYear : fiscalYear + 1;
  const start = new Date(Date.UTC(calendarYear, calendarMonth - 1, 1));
  const end = new Date(Date.UTC(calendarYear, calendarMonth, 0));
  const toDateOnly = (d: Date) => d.toISOString().slice(0, 10);
  return { start: toDateOnly(start), end: toDateOnly(end) };
}

/**
 * 指定月の資金収支(会社版家計簿)を、freeeの仕訳帳を一次データとして再構成する
 * (入出金v3、ユーザー確定 2026-09-19)。
 *
 * - キャッシュイン・キャッシュアウトはともに仕訳帳(`/api/1/journals` CSV)の、集計境界
 *   (cashAccountBoundary: 銀行口座＋現金wallet)の現金・預金行から作る(journalCashFlow.ts)。
 *   入金は営業入金・借入・保険資産回収等・その他・未分類、出金は人件費・外注費・税金社保・諸経費・その他・
 *   借入元本・支払利息・積立資産移動・未分類に区分する。自社口座間の資金移動と、帳簿に無い銀行明細の
 *   往復(ネットゼロ)は入出金に含めない。
 * - 月初・月末現預金は試算表(trial_bs)の現金・預金科目群。仕訳帳は試算表の現金・預金の借方/貸方と
 *   1円単位で一致するため、月初現預金＋キャッシュイン−キャッシュアウト＝月末現預金が成り立つ。
 *   成り立たない場合は差額を調整せず、そのまま検算差額として表示する(UIの「検算差額」行)。
 * - 営業キャッシュ収支＝営業入金−営業支出(人件費・外注費・税金社会保険等・諸経費・その他)。
 *   借入・保険資産回収等・その他入金、借入返済・利息・積立資産移動・未分類の出金は含めない。
 * - 銀行明細(wallet_txns)は、帳簿に無い往復(ネットゼロ)の存在確認にだけ使う。
 */
export async function computeMonthlyCashFlow(
  companyId: number,
  fiscalYear: number,
  calendarMonth: number,
  options: { journalGroups?: JournalGroup[] } = {}
): Promise<Omit<MonthlyCashFlow, "fiscalYear" | "month" | "fetchedAt">> {
  const { start, end } = monthDateRange(fiscalYear, calendarMonth);

  // 仕訳帳。事前取得済み(期の通期計算が1回のエクスポートを12か月に共有する)なら渡された伝票を使う。
  // 無ければ前期〜当期の範囲をエクスポートする(非同期ジョブで数秒〜数分かかる)
  const journalGroupsPromise: Promise<JournalGroup[]> = options.journalGroups
    ? Promise.resolve(options.journalGroups)
    : (() => {
        const range = journalExportRange(fiscalYear);
        return getJournalsCsv(companyId, range.start, range.end).then(parseJournalCsv);
      })();

  const [walletTxns, trialBs, accountItems, walletables, allJournalGroups] = await Promise.all([
    getWalletTxns(companyId, start, end),
    getTrialBs(companyId, { fiscalYear, startMonth: calendarMonth, endMonth: calendarMonth }),
    getAccountItems(companyId),
    getWalletables(companyId),
    journalGroupsPromise,
  ]);

  const cashTxns = walletTxns.filter((w) => isCashWalletable({ type: w.walletable_type, id: w.walletable_id }));
  const { inflow, outflow } = computeJournalCashFlow({
    companyId,
    groups: allJournalGroups.filter((g) => g.date >= start && g.date <= end),
    evidenceGroups: allJournalGroups,
    walletables,
    accountItems,
    feedIncome: cashTxns.filter((w) => w.entry_side === "income"),
    feedExpense: cashTxns.filter((w) => w.entry_side === "expense"),
  });

  const expenseByCategory: Record<ExpenseCategory, number> = {
    labor: outflow.labor,
    outsourcing: outflow.outsourcing,
    taxSocial: outflow.taxSocial,
    otherOperating: outflow.otherOperating,
    other: outflow.other,
    financing: outflow.financing,
    interest: outflow.interest,
    assetTransfer: outflow.assetTransfer,
  };
  const operatingExpense = OPERATING_CATEGORIES.reduce((sum, c) => sum + expenseByCategory[c], 0);

  const cashLeaves = trialBs.balances.filter(
    (b) => b.account_category_name === "現金・預金" && !!b.account_item_name
  );
  const cashOpening = cashLeaves.length > 0 ? cashLeaves.reduce((s, b) => s + b.opening_balance, 0) : null;
  const cashClosing = cashLeaves.length > 0 ? cashLeaves.reduce((s, b) => s + b.closing_balance, 0) : null;

  // 49期固有の証拠付き補完・除外を適用した、または未分類が残る期間は暫定
  const status: ExternalCashFlowStatus =
    inflow.appliedEvidenceIds.length > 0 ||
    outflow.appliedEvidenceIds.length > 0 ||
    inflow.unclassified !== 0 ||
    outflow.unclassified !== 0
      ? "provisional"
      : "final";

  return {
    cashOpening,
    cashClosing,
    cashChange: cashOpening !== null && cashClosing !== null ? cashClosing - cashOpening : null,
    externalIncome: inflow.total,
    externalExpenseTotal: outflow.total,
    inflow,
    outflow,
    calculationVersion: EXTERNAL_CASH_FLOW_CALCULATION_VERSION,
    status,
    expenseByCategory,
    operatingCashFlow: inflow.operating - operatingExpense,
    /** 借入元本返済のみ(利息は含まない、ユーザー確定2026-09-15。借入状況の今期返済と同じ「元本」の定義) */
    financingCashFlow: -expenseByCategory.financing,
    /** 当月支払利息。借入コストとして元本返済とは別枠 */
    interestCashFlow: -expenseByCategory.interest,
    assetTransferCashFlow: -expenseByCategory.assetTransfer,
  };
}
