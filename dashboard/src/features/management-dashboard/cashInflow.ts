import {
  AT_SOURCE_DEDUCTION_DEBIT_ACCOUNTS,
  AT_SOURCE_DEDUCTION_MEMO_SUFFIX_MIN_LENGTH,
  ASSET_RECOVERY_ACCOUNT_CATEGORIES,
  BORROWING_ACCOUNT_SUFFIX,
  CASH_JOURNAL_ACCOUNT,
  COMPOUND_PLACEHOLDER_ACCOUNT,
  LEDGER_ONLY_OPERATING_RECEIPTS,
  NET_ZERO_ROUND_TRIPS,
  NON_OPERATING_RECEIVABLE_ACCOUNTS,
  OPERATING_ACCOUNT_CATEGORIES,
  OPERATING_EXTRA_ACCOUNTS,
  OTHER_INFLOW_ACCOUNTS,
  OTHER_INFLOW_ACCOUNT_CATEGORIES,
  type CashInflowCategory,
} from "@/config/cashInflowClassification";
import { isCashWalletable } from "@/config/cashAccountBoundary";
import type { FreeeAccountItem, FreeeWalletTxn, FreeeWalletable } from "@/services/freee/freeeTransactionClient";
import type { JournalGroup, JournalLine } from "./journalCsv";

/** 未分類として残した入金の明細(金額・日付・相手科目のみ。摘要・取引先名は保存しない) */
export interface UnclassifiedInflowItem {
  date: string;
  amount: number;
  accounts: string[];
}

/**
 * 入金(キャッシュイン)の区分別内訳。仕訳帳の「現金・預金(銀行口座)借方」を、同じ伝票内の
 * 相手科目で分類した値。total(=外部入金)は5区分の合計で、通期は12か月の単純合計になる
 * (通期専用の別計算は無い、ユーザー確定、2026-09-19)。
 */
export interface CashInflowBreakdown {
  /** 営業入金: P/L売上に対応する営業債権(売掛金・受取手形・電子債権)等の実際の現金回収額(差引手数料・源泉税控除後) */
  operating: number;
  /** operatingのうち、銀行明細フィードに存在せず帳簿(仕訳帳)で補完したもの(49期の移行期のみ。内数) */
  operatingLedgerOnly: number;
  /** 借入による入金(実着金額。保証料・利息等の差引後) */
  borrowing: number;
  /** 保険・資産回収等(保険解約返戻金、資産の売却・回収) */
  assetRecovery: number;
  /** その他(還付・補助金・利息・雑収入・立替返金等) */
  other: number;
  /** 未分類(仮受金・仮払金など、相手科目から性質を判定できないもの) */
  unclassified: number;
  /** 上記5区分の合計。これが外部入金(キャッシュイン合計) */
  total: number;
  /** 参考(totalに含めない): 自社の現金・預金口座間の資金移動(積金・定期預金の元本を含む) */
  internalTransfer: number;
  /** 参考(totalに含めない): 銀行明細にあるが帳簿に無い同日・同口座・同額の入金側(NET_ZERO_ROUND_TRIPS) */
  netZeroRoundTrip: number;
  /** 参考(operatingに反映済み): 入金時に相手方が差し引き銀行には純額しか現れない分 */
  atSourceDeductions: number;
  unclassifiedItems: UnclassifiedInflowItem[];
  /** この期間に適用された証拠付き補完・除外の記録ID(監査用) */
  appliedEvidenceIds: string[];
}

export const EMPTY_INFLOW: CashInflowBreakdown = {
  operating: 0,
  operatingLedgerOnly: 0,
  borrowing: 0,
  assetRecovery: 0,
  other: 0,
  unclassified: 0,
  total: 0,
  internalTransfer: 0,
  netZeroRoundTrip: 0,
  atSourceDeductions: 0,
  unclassifiedItems: [],
  appliedEvidenceIds: [],
};

/** 複数か月(または期)のCashInflowBreakdownを単純合計する。通期=12か月合計をこの関数だけで作る */
export function sumInflows(inflows: CashInflowBreakdown[]): CashInflowBreakdown {
  const sum = (get: (i: CashInflowBreakdown) => number) => inflows.reduce((t, i) => t + get(i), 0);
  return {
    operating: sum((i) => i.operating),
    operatingLedgerOnly: sum((i) => i.operatingLedgerOnly),
    borrowing: sum((i) => i.borrowing),
    assetRecovery: sum((i) => i.assetRecovery),
    other: sum((i) => i.other),
    unclassified: sum((i) => i.unclassified),
    total: sum((i) => i.total),
    internalTransfer: sum((i) => i.internalTransfer),
    netZeroRoundTrip: sum((i) => i.netZeroRoundTrip),
    atSourceDeductions: sum((i) => i.atSourceDeductions),
    unclassifiedItems: inflows.flatMap((i) => i.unclassifiedItems),
    appliedEvidenceIds: inflows.flatMap((i) => i.appliedEvidenceIds),
  };
}

export interface ComputeCashInflowParams {
  companyId: number;
  /** 対象期間(両端含む、yyyy-mm-dd)の仕訳伝票 */
  groups: JournalGroup[];
  walletables: FreeeWalletable[];
  accountItems: FreeeAccountItem[];
  /** 対象期間の銀行明細フィードのうち入金側(NET_ZERO_ROUND_TRIPSの存在確認にだけ使う) */
  feedIncome: FreeeWalletTxn[];
}

type CategoryOf = (accountName: string) => CashInflowCategory;

function buildCategoryOf(accountItems: FreeeAccountItem[]): CategoryOf {
  const itemByName = new Map(accountItems.map((i) => [i.name, i]));
  return (accountName) => {
    const item = itemByName.get(accountName);
    if (!item) return "unclassified";
    const category = item.account_category ?? "";
    if (NON_OPERATING_RECEIVABLE_ACCOUNTS.includes(item.name)) return "other";
    if (OPERATING_ACCOUNT_CATEGORIES.includes(category) || OPERATING_EXTRA_ACCOUNTS.includes(item.name)) {
      return "operating";
    }
    if (item.name.endsWith(BORROWING_ACCOUNT_SUFFIX)) return "borrowing";
    if (ASSET_RECOVERY_ACCOUNT_CATEGORIES.includes(category)) return "assetRecovery";
    if (OTHER_INFLOW_ACCOUNT_CATEGORIES.includes(category) || OTHER_INFLOW_ACCOUNTS.includes(item.name)) {
      return "other";
    }
    return "unclassified";
  };
}

function commonSuffixLength(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

/** 金額を重みに比例して按分する(整数、端数は最大重みの区分へ) */
function allocate(total: number, weights: Map<CashInflowCategory, number>): Map<CashInflowCategory, number> {
  const result = new Map<CashInflowCategory, number>();
  const weightSum = [...weights.values()].reduce((s, w) => s + w, 0);
  if (weightSum <= 0) return result;
  let allocated = 0;
  let largest: CashInflowCategory | null = null;
  for (const [category, weight] of weights) {
    const share = Math.round((total * weight) / weightSum);
    result.set(category, share);
    allocated += share;
    if (largest === null || weight > (weights.get(largest) ?? 0)) largest = category;
  }
  if (largest !== null) result.set(largest, (result.get(largest) ?? 0) + (total - allocated));
  return result;
}

/**
 * 指定期間の入金を、仕訳帳の相手科目で区分する(入金側v3、ユーザー確定、2026-09-19)。
 *
 * 手順(伝票=JournalGroup単位):
 * 1. 銀行口座(cashAccountBoundary)の現金・預金借方行の合計=cashIn。同じ伝票の現金・預金貸方行の
 *    合計=cashOut。min(cashIn, cashOut)は自社口座間の資金移動(内部移動、外部入金に含めない)。
 *    残りが外部からの入金。定期預金解約の利息のように、元本(内部移動)と利息(外部入金)が
 *    1伝票に混在する場合も、この差し引きで自然に分かれる。
 * 2. 外部入金は、同じ伝票の非現金の貸方行(複合仕訳の中間科目「複合」は除く)を相手科目とし、
 *    勘定科目マスタのカテゴリで 営業/借入/保険・資産回収/その他/未分類 に区分する。複数区分が
 *    混在する伝票は貸方金額の比で按分する。保険解約のように資産回収と雑収入が1つの入金に
 *    まとまっている伝票は、資産回収へ寄せる(1入金=1性質。借入も同様)。
 * 3. 入金時に相手方が差し引いた手数料・源泉税等を「現金貸方のみの別伝票」で記帳している場合
 *    (銀行には純額1本しか現れない)は、同日・同口座で摘要末尾(銀行摘要)が一致する営業入金伝票を
 *    特定して営業入金から差し引く(総額/純額の正規化)。
 * 4. LEDGER_ONLY_OPERATING_RECEIPTS(銀行明細フィード欠落の営業入金)は、営業入金の内数として印付けする。
 *
 * 帳簿に無い銀行明細(NET_ZERO_ROUND_TRIPS)はこの集計に最初から現れない。
 */
export function computeCashInflow(params: ComputeCashInflowParams): CashInflowBreakdown {
  const { companyId, groups, walletables, accountItems, feedIncome } = params;
  const categoryOf = buildCategoryOf(accountItems);
  const walletableByName = new Map<string, FreeeWalletable>();
  for (const w of walletables) if (w.name) walletableByName.set(w.name, w);

  const isBoundaryCashLine = (line: JournalLine): FreeeWalletable | null => {
    if (line.account !== CASH_JOURNAL_ACCOUNT) return null;
    const w = walletableByName.get(line.subAccount);
    return w && isCashWalletable(w) ? w : null;
  };

  const totals: Record<CashInflowCategory, number> = {
    operating: 0,
    borrowing: 0,
    assetRecovery: 0,
    other: 0,
    unclassified: 0,
  };
  let internalTransfer = 0;
  const unclassifiedItems: UnclassifiedInflowItem[] = [];
  /** 営業入金として計上した現金借方行(日付・口座・摘要・金額)。差引伝票との照合と補完印付けに使う */
  const operatingReceiptLines: { date: string; walletableId: number; amount: number; memo: string }[] = [];

  for (const group of groups) {
    const cashDebitLines = group.debits
      .map((line) => ({ line, wallet: isBoundaryCashLine(line) }))
      .filter((x): x is { line: JournalLine; wallet: FreeeWalletable } => x.wallet !== null);
    const cashIn = cashDebitLines.reduce((s, x) => s + x.line.amount, 0);
    if (cashIn <= 0) continue;

    const cashOut = group.credits.filter((l) => l.account === CASH_JOURNAL_ACCOUNT).reduce((s, l) => s + l.amount, 0);
    const internal = Math.min(cashIn, cashOut);
    internalTransfer += internal;
    const external = cashIn - internal;
    if (external <= 0) continue;

    // 相手科目の区分ごとの貸方金額(重み)
    const weights = new Map<CashInflowCategory, number>();
    const counterAccounts = new Set<string>();
    for (const credit of group.credits) {
      if (credit.account === CASH_JOURNAL_ACCOUNT || credit.account === COMPOUND_PLACEHOLDER_ACCOUNT) continue;
      counterAccounts.add(credit.account);
      const category = categoryOf(credit.account);
      weights.set(category, (weights.get(category) ?? 0) + credit.amount);
    }
    // 1入金=1性質: 資産回収(保険解約等)・借入の伝票に付随する雑収入等のその他は、その性質へ寄せる
    const otherWeight = weights.get("other") ?? 0;
    if (otherWeight > 0) {
      const host: CashInflowCategory | null = weights.has("assetRecovery")
        ? "assetRecovery"
        : weights.has("borrowing")
          ? "borrowing"
          : null;
      if (host !== null) {
        weights.set(host, (weights.get(host) ?? 0) + otherWeight);
        weights.delete("other");
      }
    }

    if (weights.size === 0) {
      totals.unclassified += external;
      unclassifiedItems.push({ date: group.date, amount: external, accounts: [] });
      continue;
    }

    const allocation = allocate(external, weights);
    for (const [category, amount] of allocation) {
      totals[category] += amount;
      if (category === "unclassified" && amount !== 0) {
        unclassifiedItems.push({ date: group.date, amount, accounts: [...counterAccounts].sort() });
      }
    }

    const operatingAmount = allocation.get("operating") ?? 0;
    if (operatingAmount > 0) {
      // 営業入金伝票の現金借方行。差引伝票との照合用(伝票に複数の現金借方行がある場合は行ごとに登録)
      for (const { line, wallet } of cashDebitLines) {
        operatingReceiptLines.push({ date: group.date, walletableId: wallet.id, amount: line.amount, memo: line.memo.trim() });
      }
    }
  }

  // 入金時差引の純額化: 現金貸方のみ・非現金借方が手数料/源泉税/手形売却損のみの伝票を、
  // 同日・同口座・摘要末尾(銀行摘要)一致の営業入金伝票に結び付けて営業入金から差し引く
  let atSourceDeductions = 0;
  for (const group of groups) {
    if (group.debits.some((l) => l.account === CASH_JOURNAL_ACCOUNT)) continue;
    const cashCredits = group.credits.filter((l) => l.account === CASH_JOURNAL_ACCOUNT);
    if (cashCredits.length !== 1) continue;
    const nonCashDebits = group.debits.filter((l) => l.account !== COMPOUND_PLACEHOLDER_ACCOUNT);
    const nonCashCredits = group.credits.filter(
      (l) => l.account !== CASH_JOURNAL_ACCOUNT && l.account !== COMPOUND_PLACEHOLDER_ACCOUNT
    );
    if (nonCashDebits.length === 0 || nonCashCredits.length > 0) continue;
    if (!nonCashDebits.every((l) => AT_SOURCE_DEDUCTION_DEBIT_ACCOUNTS.includes(l.account))) continue;

    const credit = cashCredits[0];
    const wallet = walletableByName.get(credit.subAccount);
    if (!wallet || !isCashWalletable(wallet)) continue;
    const memo = credit.memo.trim();
    const linked = operatingReceiptLines.some(
      (r) =>
        r.date === group.date &&
        r.walletableId === wallet.id &&
        commonSuffixLength(memo, r.memo) >= AT_SOURCE_DEDUCTION_MEMO_SUFFIX_MIN_LENGTH
    );
    if (linked) atSourceDeductions += credit.amount;
  }
  totals.operating -= atSourceDeductions;

  // 銀行明細フィード欠落の営業入金(帳簿補完)を、仕訳帳に同日・同口座・同額の営業入金行がある
  // ものだけ印付けする(内数)。各行は1回しか使わない
  const appliedEvidenceIds: string[] = [];
  let operatingLedgerOnly = 0;
  const availableLines = [...operatingReceiptLines];
  for (const receipt of LEDGER_ONLY_OPERATING_RECEIPTS) {
    if (receipt.companyId !== companyId) continue;
    const index = availableLines.findIndex(
      (r) => r.date === receipt.date && r.walletableId === receipt.walletableId && r.amount === receipt.amount
    );
    if (index < 0) continue;
    availableLines.splice(index, 1);
    operatingLedgerOnly += receipt.amount;
    appliedEvidenceIds.push(receipt.id);
  }

  // 銀行明細にあるが帳簿に無い往復(参考表示。集計には元々含まれない)
  let netZeroRoundTrip = 0;
  const feedIncomeIds = new Set(feedIncome.map((w) => w.id));
  for (const trip of NET_ZERO_ROUND_TRIPS) {
    if (trip.companyId !== companyId || !feedIncomeIds.has(trip.incomeWalletTxnId)) continue;
    netZeroRoundTrip += trip.amount;
    appliedEvidenceIds.push(trip.id);
  }

  const total = totals.operating + totals.borrowing + totals.assetRecovery + totals.other + totals.unclassified;
  return {
    operating: totals.operating,
    operatingLedgerOnly,
    borrowing: totals.borrowing,
    assetRecovery: totals.assetRecovery,
    other: totals.other,
    unclassified: totals.unclassified,
    total,
    internalTransfer,
    netZeroRoundTrip,
    atSourceDeductions,
    unclassifiedItems,
    appliedEvidenceIds,
  };
}
