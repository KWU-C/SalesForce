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
import {
  designatedContractorByItem,
  designatedContractorByPartner,
  EMPLOYEE_BONUS_ACCOUNTS,
  EXECUTIVE_PAY_ACCOUNTS,
  EXECUTIVE_PAYROLL_MEMO_PREFIXES,
  isBankFeedUnavailable,
  OTHER_OUTFLOW_PL_CATEGORIES,
  PAYABLE_ACCOUNTS,
  PAYROLL_MEMO_DEPARTMENT_PREFIXES,
  RETIREMENT_ACCOUNTS,
  PAYROLL_MEMO_LABEL_TOKEN,
  PAYROLL_MEMO_TRANSFER_TOKEN,
  SOCIAL_INSURANCE_MEMO_TOKENS,
} from "@/config/cashOutflowClassification";
import { matchExpenseCategory } from "@/config/freeeExpenseClassification";
import { isCashWalletable } from "@/config/cashAccountBoundary";
import type { FreeeAccountItem, FreeeWalletTxn, FreeeWalletable } from "@/services/freee/freeeTransactionClient";
import type { CashInflowBreakdown, UnclassifiedInflowItem } from "./cashInflow";
import type { CashOutflowBreakdown, LaborDetail, OutflowCategory, UnclassifiedOutflowItem } from "./cashOutflow";
import type { JournalGroup, JournalLine } from "./journalCsv";

export interface ComputeJournalCashFlowParams {
  companyId: number;
  /** 集計対象期間(両端含む)の仕訳伝票。入金・出金はこの伝票から作る */
  groups: JournalGroup[];
  /**
   * 債務(未払金・買掛金)の原因科目を辿るための伝票。通常は対象期を含む広い範囲(前期〜当期)の
   * 全伝票を渡す(債務の支払は前月・前期に発生した費用の精算のため)。省略時はgroups。
   */
  evidenceGroups?: JournalGroup[];
  walletables: FreeeWalletable[];
  accountItems: FreeeAccountItem[];
  /** 対象期間の銀行明細フィードの入金側・出金側(NET_ZERO_ROUND_TRIPSの存在確認にだけ使う) */
  feedIncome: FreeeWalletTxn[];
  feedExpense: FreeeWalletTxn[];
}

export interface JournalCashFlow {
  inflow: CashInflowBreakdown;
  outflow: CashOutflowBreakdown;
}

const OUTFLOW_CATEGORY_KEYS = [
  "labor",
  "outsourcing",
  "taxSocial",
  "otherOperating",
  "other",
  "financing",
  "interest",
  "assetTransfer",
  "unclassified",
] as const satisfies readonly OutflowCategory[];

function commonSuffixLength(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

/** 金額を重みに比例して按分する(整数、端数は最大重みの区分へ)。重みの合計が0以下なら空 */
function allocate<K>(total: number, weights: Map<K, number>): Map<K, number> {
  const result = new Map<K, number>();
  const weightSum = [...weights.values()].reduce((s, w) => s + w, 0);
  if (weightSum <= 0) return result;
  let allocated = 0;
  let largest: K | null = null;
  for (const [key, weight] of weights) {
    const share = Math.round((total * weight) / weightSum);
    result.set(key, share);
    allocated += share;
    if (largest === null || weight > (weights.get(largest) ?? 0)) largest = key;
  }
  if (largest !== null) result.set(largest, (result.get(largest) ?? 0) + (total - allocated));
  return result;
}

type InflowCategoryOf = (accountName: string) => CashInflowCategory;

function buildInflowCategoryOf(accountItems: FreeeAccountItem[]): InflowCategoryOf {
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

/** 費用等の借方科目 → 出金区分。区分リストに無い損益科目は「その他」、貸借対照表科目・未知の科目は「未分類」 */
function buildOutflowCategoryOf(accountItems: FreeeAccountItem[]) {
  const itemByName = new Map(accountItems.map((i) => [i.name, i]));
  return (accountName: string): OutflowCategory => {
    const matched = matchExpenseCategory(accountName);
    if (matched !== null) return matched;
    const item = itemByName.get(accountName);
    if (item && OTHER_OUTFLOW_PL_CATEGORIES.includes(item.account_category ?? "")) return "other";
    return "unclassified";
  };
}

/**
 * 出金の集計単位(バケット)。区分(OutflowCategory)そのものか、「給与・人件費」の内訳を表す
 * `labor:employeeSalary|employeeBonus|executive|retirement|contractor:{氏名}`。
 * 内訳は区分に集約すると必ず「labor」になる(合計は変わらない、参考表示のためだけの細分)。
 */
type OutflowBucket = string;

const LABOR_PREFIX = "labor:";
const CONTRACTOR_PREFIX = "labor:contractor:";

function bucketCategory(bucket: OutflowBucket): OutflowCategory {
  return bucket.startsWith(LABOR_PREFIX) ? "labor" : (bucket as OutflowCategory);
}

/**
 * v3.1より前の区分(指定業務委託は外注費、退職金はその他)。1伝票の現金支払額はまず旧区分に按分し、
 * その額を旧区分の中でバケットに細分する(二段階按分)。これにより、旧区分ごとの整数金額が
 * 変更前と完全に同じになり、指定業務委託と退職金を給与・人件費へ移しても営業支出合計は
 * 構造的に変わらない(円未満の按分誤差も新たに生じない)。
 */
function legacyCategory(bucket: OutflowBucket): OutflowCategory {
  if (bucket.startsWith(CONTRACTOR_PREFIX)) return "outsourcing";
  if (bucket === `${LABOR_PREFIX}retirement`) return "other";
  return bucketCategory(bucket);
}

/** 二段階按分: 旧区分へ按分 → 各旧区分の額をその区分に属するバケットへ按分 */
function allocateTwoStage(total: number, weights: Map<OutflowBucket, number>): Map<OutflowBucket, number> {
  const legacyWeights = new Map<OutflowCategory, number>();
  for (const [bucket, weight] of weights) {
    const c = legacyCategory(bucket);
    legacyWeights.set(c, (legacyWeights.get(c) ?? 0) + weight);
  }
  const result = new Map<OutflowBucket, number>();
  for (const [category, amount] of allocate(total, legacyWeights)) {
    const members = new Map<OutflowBucket, number>();
    for (const [bucket, weight] of weights) if (legacyCategory(bucket) === category) members.set(bucket, weight);
    for (const [bucket, share] of allocate(amount, members)) result.set(bucket, (result.get(bucket) ?? 0) + share);
  }
  return result;
}

function stripManufacturingPrefix(accountName: string): string {
  return accountName.startsWith("[製]") ? accountName.slice("[製]".length) : accountName;
}

/**
 * 借方科目 → バケット。区分が「給与・人件費」なら内訳(役員/賞与/退職金/従業員給与)、
 * 「外注費」で指定業務委託(副キー: 品目名、主キー: 取引先名)に該当すれば給与・人件費の指定業務委託。
 * itemName=借方行の補助科目(品目名)、partnerName=同じ伝票の債務(未払金・買掛金)の取引先名(無ければ空)。
 */
function makeBucketOf(outflowCategoryOf: (accountName: string) => OutflowCategory) {
  return (accountName: string, itemName: string, partnerName: string): OutflowBucket => {
    const category = outflowCategoryOf(accountName);
    if (category === "outsourcing") {
      const contractor = designatedContractorByPartner(partnerName) ?? designatedContractorByItem(itemName);
      return contractor !== null ? `${CONTRACTOR_PREFIX}${contractor}` : category;
    }
    if (category === "labor") {
      const base = stripManufacturingPrefix(accountName);
      if (EXECUTIVE_PAY_ACCOUNTS.includes(base)) return `${LABOR_PREFIX}executive`;
      if (EMPLOYEE_BONUS_ACCOUNTS.includes(base)) return `${LABOR_PREFIX}employeeBonus`;
      if (RETIREMENT_ACCOUNTS.includes(base)) return `${LABOR_PREFIX}retirement`;
      return `${LABOR_PREFIX}employeeSalary`;
    }
    return category;
  };
}

interface PayableMix {
  weights: Map<OutflowBucket, number>;
  method: "trace" | "memo";
}

function payableKey(account: string, subAccount: string): string {
  return `${account}|${subAccount}`;
}

/** 債務(未払金・買掛金)の(債務科目, 取引先)ごとに、発生仕訳の借方科目の構成(区分別金額)を集める */
function buildPayableEvidence(
  groups: JournalGroup[],
  bucketOf: (accountName: string, itemName: string, partnerName: string) => OutflowBucket
): Map<string, Map<OutflowBucket, number>> {
  const evidence = new Map<string, Map<OutflowBucket, number>>();
  for (const group of groups) {
    if (group.credits.some((l) => l.account === CASH_JOURNAL_ACCOUNT)) continue; // 支払伝票は発生ではない
    const debitLines = group.debits.filter(
      (l) =>
        l.account !== CASH_JOURNAL_ACCOUNT &&
        l.account !== COMPOUND_PLACEHOLDER_ACCOUNT &&
        !PAYABLE_ACCOUNTS.includes(l.account) &&
        l.amount > 0
    );
    const debitTotal = debitLines.reduce((s, l) => s + l.amount, 0);
    if (debitTotal === 0) continue;
    for (const credit of group.credits) {
      if (!PAYABLE_ACCOUNTS.includes(credit.account) || credit.amount <= 0) continue;
      const key = payableKey(credit.account, credit.subAccount);
      const mix = evidence.get(key) ?? new Map<OutflowBucket, number>();
      for (const debit of debitLines) {
        const category = bucketOf(debit.account, debit.subAccount, credit.subAccount);
        mix.set(category, (mix.get(category) ?? 0) + (credit.amount * debit.amount) / debitTotal);
      }
      evidence.set(key, mix);
    }
  }
  return evidence;
}

/**
 * 債務の精算行の区分を決める。優先順位(摘要ルールは補助判定、ユーザー確定 2026-09-19):
 * 1. 取引先(補助科目)があり、その取引先の発生仕訳が範囲内にあれば、その借方科目の構成で按分(仕訳科目による判定)
 * 2. 判定できない場合のみ摘要ルール(社会保険料→税金・社会保険等、給与振込→人件費)
 * 3. どれにも当たらなければnull(呼び出し側が未分類にする)
 * 補助科目が空欄の債務は取引先が特定できず、空欄全体の構成は個別の支払の根拠にならないため使わない。
 */
function payableMix(line: JournalLine, evidence: Map<string, Map<OutflowBucket, number>>): PayableMix | null {
  if (line.subAccount !== "") {
    const mix = evidence.get(payableKey(line.account, line.subAccount));
    if (mix && mix.size > 0) return { weights: new Map(mix), method: "trace" };
  }
  const memo = line.memo;
  if (SOCIAL_INSURANCE_MEMO_TOKENS.some((t) => memo.includes(t))) {
    return { weights: new Map<OutflowBucket, number>([["taxSocial", 1]]), method: "memo" };
  }
  const isPayroll =
    line.account === "未払金" &&
    line.subAccount === "" &&
    ((PAYROLL_MEMO_DEPARTMENT_PREFIXES.some((p) => memo.startsWith(p)) && memo.includes(PAYROLL_MEMO_TRANSFER_TOKEN)) ||
      memo.includes(PAYROLL_MEMO_LABEL_TOKEN));
  if (isPayroll) {
    // 取締役タグの振込・「【給与】」の現金渡し(役員報酬)は役員、それ以外の給与振込は従業員給与
    const executive =
      EXECUTIVE_PAYROLL_MEMO_PREFIXES.some((p) => memo.startsWith(p)) || memo.includes(PAYROLL_MEMO_LABEL_TOKEN);
    return {
      weights: new Map<OutflowBucket, number>([[executive ? `${LABOR_PREFIX}executive` : `${LABOR_PREFIX}employeeSalary`, 1]]),
      method: "memo",
    };
  }
  return null;
}

interface CashLine {
  line: JournalLine;
  wallet: FreeeWalletable;
}

interface GroupWork {
  group: JournalGroup;
  boundaryDebits: CashLine[];
  boundaryCredits: CashLine[];
  /** 集計境界内の現金・預金の借方/貸方の合計 */
  cashInBoundary: number;
  cashOutBoundary: number;
  /** 境界外(現金・預金だが口座が境界外/不明)を含む、全ての現金・預金行の借方/貸方の合計 */
  cashInAny: number;
  cashOutAny: number;
  // 入金
  inflowInternal: number;
  inflowExternal: number;
  inflowWeights: Map<CashInflowCategory, number>;
  inflowCounterAccounts: string[];
  // 出金
  isAtSourceDeduction: boolean;
  outflowInternal: number;
  outflowExternal: number;
  outflowAllocation: Map<OutflowBucket, number>;
  outflowLedgerOnly: number;
  /** 入金として記帳されているが出金の訂正と判定したときの、訂正先の出金伝票 */
  correctionTargets: GroupWork[];
}

/**
 * 仕訳帳から入金(キャッシュイン)と出金(キャッシュアウト)を一括で分類する(入出金v3、2026-09-19)。
 * 入金と出金は次の2つの規則で結び付いているため、1つの関数で同時に計算する。
 *
 * 共通: 集計境界(cashAccountBoundary。銀行口座＋現金walletの許可リスト)の現金・預金行を対象とし、
 * 同じ伝票内の現金→現金(内部移動)は入出金のどちらにも含めない。
 * 入金側: 現金借方行を、同じ伝票の貸方科目(勘定科目マスタのカテゴリ)で 営業/借入/保険・資産回収/その他/
 *   未分類 に区分。1入金=1性質(保険・借入に付随する雑収入は寄せる)。
 * 出金側: 現金貸方行を、同じ伝票の借方科目で 人件費/外注費/税金・社保/諸経費/その他/借入元本/利息/
 *   積立資産移動/未分類 に区分。借方が債務(未払金・買掛金)の場合は発生時の費用科目を辿る
 *   (取引先ごとの発生仕訳の構成)。貸方の預り金・未払金等は総額/純額の差なので、借方の金額比で
 *   按分してから現金の実額に合わせる。
 * 総額/純額の規則:
 *  A. 入金時に相手方が差し引いた手数料・源泉税等を「現金貸方のみの別伝票」で記帳している場合は、
 *     営業入金から差し引き(純額化)、その現金貸方は出金に数えない。
 *  B. 仕訳科目で分類できない入金(未分類)が、同日・同口座の出金伝票と銀行摘要末尾が一致する場合は、
 *     入金ではなく出金の訂正(銀行の実際の出金が帳簿の合計より小さい)として、出金の区分を純額化する。
 */
export function computeJournalCashFlow(params: ComputeJournalCashFlowParams): JournalCashFlow {
  const { companyId, groups, walletables, accountItems, feedIncome, feedExpense } = params;
  const inflowCategoryOf = buildInflowCategoryOf(accountItems);
  const outflowCategoryOf = buildOutflowCategoryOf(accountItems);
  const bucketOf = makeBucketOf(outflowCategoryOf);
  const evidence = buildPayableEvidence(params.evidenceGroups ?? groups, bucketOf);
  const walletableByName = new Map<string, FreeeWalletable>();
  for (const w of walletables) if (w.name) walletableByName.set(w.name, w);

  const toBoundaryLines = (lines: JournalLine[]): CashLine[] => {
    const result: CashLine[] = [];
    for (const line of lines) {
      if (line.account !== CASH_JOURNAL_ACCOUNT) continue;
      const wallet = walletableByName.get(line.subAccount);
      if (wallet && isCashWalletable(wallet)) result.push({ line, wallet });
    }
    return result;
  };
  const sumAmount = (lines: { amount: number }[]) => lines.reduce((s, l) => s + l.amount, 0);

  const works: GroupWork[] = groups.map((group) => {
    const boundaryDebits = toBoundaryLines(group.debits);
    const boundaryCredits = toBoundaryLines(group.credits);
    return {
      group,
      boundaryDebits,
      boundaryCredits,
      cashInBoundary: boundaryDebits.reduce((s, x) => s + x.line.amount, 0),
      cashOutBoundary: boundaryCredits.reduce((s, x) => s + x.line.amount, 0),
      cashInAny: sumAmount(group.debits.filter((l) => l.account === CASH_JOURNAL_ACCOUNT)),
      cashOutAny: sumAmount(group.credits.filter((l) => l.account === CASH_JOURNAL_ACCOUNT)),
      inflowInternal: 0,
      inflowExternal: 0,
      inflowWeights: new Map(),
      inflowCounterAccounts: [],
      isAtSourceDeduction: false,
      outflowInternal: 0,
      outflowExternal: 0,
      outflowAllocation: new Map(),
      outflowLedgerOnly: 0,
      correctionTargets: [],
    };
  });

  // ---- 入金の区分(伝票ごと)
  for (const w of works) {
    if (w.cashInBoundary <= 0) continue;
    w.inflowInternal = Math.min(w.cashInBoundary, w.cashOutAny);
    w.inflowExternal = w.cashInBoundary - w.inflowInternal;
    if (w.inflowExternal <= 0) continue;
    const weights = new Map<CashInflowCategory, number>();
    const counters = new Set<string>();
    for (const credit of w.group.credits) {
      if (credit.account === CASH_JOURNAL_ACCOUNT || credit.account === COMPOUND_PLACEHOLDER_ACCOUNT) continue;
      counters.add(credit.account);
      const category = inflowCategoryOf(credit.account);
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
    w.inflowWeights = weights;
    w.inflowCounterAccounts = [...counters].sort();
  }

  // ---- 規則A: 入金時差引の別伝票(現金貸方のみ)を、同日・同口座・銀行摘要末尾一致の営業入金に結び付ける
  const operatingReceiptLines: { date: string; walletableId: number; amount: number; memo: string }[] = [];
  for (const w of works) {
    if (w.inflowExternal <= 0) continue;
    if ((w.inflowWeights.get("operating") ?? 0) <= 0) continue;
    for (const { line, wallet } of w.boundaryDebits) {
      operatingReceiptLines.push({ date: w.group.date, walletableId: wallet.id, amount: line.amount, memo: line.memo.trim() });
    }
  }
  let atSourceDeductions = 0;
  for (const w of works) {
    const { group } = w;
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
    if (linked) {
      w.isAtSourceDeduction = true;
      atSourceDeductions += credit.amount;
    }
  }

  // ---- 出金の区分(伝票ごと)。規則Aの伝票は出金に数えない(営業入金の純額化で反映済み)
  const unclassifiedOutflowItems: UnclassifiedOutflowItem[] = [];
  let payableTraced = 0;
  let payableByMemoRule = 0;
  let ledgerOnlyTotal = 0;
  for (const w of works) {
    if (w.cashOutBoundary <= 0 || w.isAtSourceDeduction) continue;
    w.outflowInternal = Math.min(w.cashOutBoundary, w.cashInAny);
    w.outflowExternal = w.cashOutBoundary - w.outflowInternal;
    if (w.outflowExternal <= 0) continue;

    const weights = new Map<OutflowBucket, number>();
    const unclassifiedReasons: { weight: number; item: Pick<UnclassifiedOutflowItem, "reason" | "account"> }[] = [];
    const addWeight = (category: OutflowBucket, amount: number) =>
      weights.set(category, (weights.get(category) ?? 0) + amount);
    for (const debit of w.group.debits) {
      if (debit.account === CASH_JOURNAL_ACCOUNT || debit.account === COMPOUND_PLACEHOLDER_ACCOUNT) continue;
      if (debit.amount <= 0) continue;
      if (PAYABLE_ACCOUNTS.includes(debit.account)) {
        const mix = payableMix(debit, evidence);
        if (mix === null) {
          addWeight("unclassified", debit.amount);
          unclassifiedReasons.push({ weight: debit.amount, item: { reason: "payable_untraceable", account: debit.account } });
          continue;
        }
        const mixTotal = [...mix.weights.values()].reduce((s, v) => s + v, 0);
        for (const [category, value] of mix.weights) addWeight(category, (debit.amount * value) / mixTotal);
        // 取引先の発生仕訳の借方に、立替金など区分できない科目が混じっている場合の未分類分
        const unclassifiedShare = mix.weights.get("unclassified") ?? 0;
        if (unclassifiedShare > 0) {
          unclassifiedReasons.push({
            weight: (debit.amount * unclassifiedShare) / mixTotal,
            item: { reason: "balance_sheet_account", account: debit.account },
          });
        }
        if (mix.method === "trace") payableTraced += debit.amount;
        else payableByMemoRule += debit.amount;
      } else {
        const category = bucketOf(debit.account, debit.subAccount, "");
        addWeight(category, debit.amount);
        if (category === "unclassified") {
          unclassifiedReasons.push({ weight: debit.amount, item: { reason: "balance_sheet_account", account: debit.account } });
        }
      }
    }
    if (weights.size === 0) {
      w.outflowAllocation = new Map<OutflowBucket, number>([["unclassified", w.outflowExternal]]);
      unclassifiedOutflowItems.push({ date: w.group.date, amount: w.outflowExternal, reason: "no_debit_account", account: "" });
    } else {
      w.outflowAllocation = allocateTwoStage(w.outflowExternal, weights);
      const unclassifiedAmount = w.outflowAllocation.get("unclassified") ?? 0;
      if (unclassifiedAmount !== 0) {
        const main = unclassifiedReasons.sort((a, b) => b.weight - a.weight)[0]?.item ?? {
          reason: "balance_sheet_account" as const,
          account: "",
        };
        unclassifiedOutflowItems.push({ date: w.group.date, amount: unclassifiedAmount, ...main });
      }
    }
    const gapCredit = w.boundaryCredits
      .filter((x) => isBankFeedUnavailable(x.wallet.id, w.group.date))
      .reduce((s, x) => s + x.line.amount, 0);
    w.outflowLedgerOnly = (w.outflowExternal * gapCredit) / w.cashOutBoundary;
    ledgerOnlyTotal += w.outflowLedgerOnly;
  }

  // ---- 規則B: 分類できない入金が同日・同口座の出金伝票と銀行摘要末尾で一致 → 出金の訂正
  let reclassifiedAsCorrection = 0;
  const correctionByCategory = new Map<OutflowBucket, number>();
  for (const w of works) {
    if (w.inflowExternal <= 0) continue;
    const onlyUnclassified =
      w.inflowWeights.size === 0 || [...w.inflowWeights.keys()].every((k) => k === "unclassified");
    if (!onlyUnclassified) continue;
    const debit = w.boundaryDebits[0];
    const memo = debit.line.memo.trim();
    const targets = works.filter(
      (o) =>
        o !== w &&
        o.group.date === w.group.date &&
        o.outflowExternal > 0 &&
        o.boundaryCredits.some(
          (c) =>
            c.wallet.id === debit.wallet.id &&
            commonSuffixLength(memo, c.line.memo.trim()) >= AT_SOURCE_DEDUCTION_MEMO_SUFFIX_MIN_LENGTH
        )
    );
    if (targets.length === 0) continue;
    w.correctionTargets = targets;
    const targetWeights = new Map<OutflowBucket, number>();
    for (const t of targets) for (const [k, v] of t.outflowAllocation) targetWeights.set(k, (targetWeights.get(k) ?? 0) + v);
    for (const [k, v] of allocate(w.inflowExternal, targetWeights)) {
      correctionByCategory.set(k, (correctionByCategory.get(k) ?? 0) + v);
    }
    reclassifiedAsCorrection += w.inflowExternal;
  }

  // ---- 入金の集計
  const inflowTotals: Record<CashInflowCategory, number> = {
    operating: 0,
    borrowing: 0,
    assetRecovery: 0,
    other: 0,
    unclassified: 0,
  };
  let inflowInternal = 0;
  const unclassifiedInflowItems: UnclassifiedInflowItem[] = [];
  const availableOperatingLines = [...operatingReceiptLines];
  for (const w of works) {
    inflowInternal += w.inflowInternal;
    if (w.inflowExternal <= 0 || w.correctionTargets.length > 0) continue;
    if (w.inflowWeights.size === 0) {
      inflowTotals.unclassified += w.inflowExternal;
      unclassifiedInflowItems.push({ date: w.group.date, amount: w.inflowExternal, accounts: [] });
      continue;
    }
    for (const [category, amount] of allocate(w.inflowExternal, w.inflowWeights)) {
      inflowTotals[category] += amount;
      if (category === "unclassified" && amount !== 0) {
        unclassifiedInflowItems.push({ date: w.group.date, amount, accounts: w.inflowCounterAccounts });
      }
    }
  }
  inflowTotals.operating -= atSourceDeductions;

  const inflowEvidenceIds: string[] = [];
  const outflowEvidenceIds: string[] = [];
  let operatingLedgerOnly = 0;
  for (const receipt of LEDGER_ONLY_OPERATING_RECEIPTS) {
    if (receipt.companyId !== companyId) continue;
    const index = availableOperatingLines.findIndex(
      (r) => r.date === receipt.date && r.walletableId === receipt.walletableId && r.amount === receipt.amount
    );
    if (index < 0) continue;
    availableOperatingLines.splice(index, 1);
    operatingLedgerOnly += receipt.amount;
    inflowEvidenceIds.push(receipt.id);
  }

  let netZeroIncome = 0;
  let netZeroExpense = 0;
  const incomeIds = new Set(feedIncome.map((x) => x.id));
  const expenseIds = new Set(feedExpense.map((x) => x.id));
  for (const trip of NET_ZERO_ROUND_TRIPS) {
    if (trip.companyId !== companyId) continue;
    if (incomeIds.has(trip.incomeWalletTxnId)) {
      netZeroIncome += trip.amount;
      inflowEvidenceIds.push(trip.id);
    }
    if (expenseIds.has(trip.expenseWalletTxnId)) {
      netZeroExpense += trip.amount;
      outflowEvidenceIds.push(trip.id);
    }
  }

  const inflowTotal =
    inflowTotals.operating + inflowTotals.borrowing + inflowTotals.assetRecovery + inflowTotals.other + inflowTotals.unclassified;
  const inflow: CashInflowBreakdown = {
    operating: inflowTotals.operating,
    operatingLedgerOnly,
    borrowing: inflowTotals.borrowing,
    assetRecovery: inflowTotals.assetRecovery,
    other: inflowTotals.other,
    unclassified: inflowTotals.unclassified,
    total: inflowTotal,
    internalTransfer: inflowInternal,
    netZeroRoundTrip: netZeroIncome,
    atSourceDeductions,
    reclassifiedAsOutflowCorrection: reclassifiedAsCorrection,
    unclassifiedItems: unclassifiedInflowItems,
    appliedEvidenceIds: inflowEvidenceIds,
  };

  // ---- 出金の集計(バケット→区分。給与・人件費は内訳も集計する)
  const outflowTotals: Record<OutflowCategory, number> = {
    labor: 0,
    outsourcing: 0,
    taxSocial: 0,
    otherOperating: 0,
    other: 0,
    financing: 0,
    interest: 0,
    assetTransfer: 0,
    unclassified: 0,
  };
  const laborBuckets = new Map<OutflowBucket, number>();
  const addBucket = (bucket: OutflowBucket, amount: number) => {
    outflowTotals[bucketCategory(bucket)] += amount;
    if (bucket.startsWith(LABOR_PREFIX)) laborBuckets.set(bucket, (laborBuckets.get(bucket) ?? 0) + amount);
  };
  let outflowInternal = 0;
  let deductionsExcluded = 0;
  for (const w of works) {
    outflowInternal += w.outflowInternal;
    if (w.isAtSourceDeduction) deductionsExcluded += w.cashOutBoundary;
    for (const [bucket, amount] of w.outflowAllocation) addBucket(bucket, amount);
  }
  for (const [bucket, amount] of correctionByCategory) addBucket(bucket, -amount);

  // 賞与の分離: 賞与は発生仕訳(借方=賞与、現金貸方なし、貸方=未払金)で計上され、支払は他の給与と同じ
  // 部門別の給与振込(摘要ルール)に混ざる。発生月の未払金(=手取りの賞与)を、同月の従業員給与から従業員賞与へ
  // 付け替える(合計は変わらない)。役員賞与だけの仕訳は役員(役員報酬・役員賞与で1区分)のままで移動不要
  let employeeBonusPayable = 0;
  for (const group of groups) {
    if (group.credits.some((l) => l.account === CASH_JOURNAL_ACCOUNT)) continue;
    const bonusDebits = group.debits.filter(
      (l) => l.amount > 0 && EMPLOYEE_BONUS_ACCOUNTS.includes(stripManufacturingPrefix(l.account))
    );
    if (bonusDebits.length === 0) continue;
    employeeBonusPayable += group.credits.filter((l) => l.account === "未払金").reduce((s, l) => s + l.amount, 0);
  }
  const salaryKey = `${LABOR_PREFIX}employeeSalary`;
  const bonusKey = `${LABOR_PREFIX}employeeBonus`;
  const shift = Math.min(employeeBonusPayable, Math.max(0, laborBuckets.get(salaryKey) ?? 0));
  if (shift > 0) {
    laborBuckets.set(salaryKey, (laborBuckets.get(salaryKey) ?? 0) - shift);
    laborBuckets.set(bonusKey, (laborBuckets.get(bonusKey) ?? 0) + shift);
  }

  const contractors: Record<string, number> = {};
  for (const [bucket, amount] of laborBuckets) {
    if (bucket.startsWith(CONTRACTOR_PREFIX)) contractors[bucket.slice(CONTRACTOR_PREFIX.length)] = amount;
  }
  const laborDetail: LaborDetail = {
    employeeSalary: laborBuckets.get(salaryKey) ?? 0,
    employeeBonus: laborBuckets.get(bonusKey) ?? 0,
    executive: laborBuckets.get(`${LABOR_PREFIX}executive`) ?? 0,
    retirement: laborBuckets.get(`${LABOR_PREFIX}retirement`) ?? 0,
    contractors,
  };
  const outflowTotal = OUTFLOW_CATEGORY_KEYS.reduce((s, k) => s + outflowTotals[k], 0);
  const outflow: CashOutflowBreakdown = {
    ...outflowTotals,
    total: outflowTotal,
    internalTransfer: outflowInternal,
    netZeroRoundTrip: netZeroExpense,
    outflowCorrections: reclassifiedAsCorrection,
    atSourceDeductionsExcluded: deductionsExcluded,
    ledgerOnly: Math.round(ledgerOnlyTotal),
    payableTraced,
    payableByMemoRule,
    laborDetail,
    unclassifiedItems: unclassifiedOutflowItems,
    appliedEvidenceIds: outflowEvidenceIds,
  };
  return { inflow, outflow };
}
