import type { FreeeTransfer, FreeeWalletTxn } from "@/services/freee/freeeTransactionClient";
import {
  EXTERNAL_CASH_FLOW_OVERRIDES,
  EXTERNAL_CASH_FLOW_TENTATIVE_CANDIDATES,
  EXTERNAL_CASH_FLOW_UNRESOLVED_ITEMS,
  type ExternalCashFlowOverride,
  type UnresolvedCashFlowItem,
} from "@/config/externalCashFlowOverrides";

/**
 * 外部入金・外部支出の「恒久ロジック」バージョン。境界定義・照合ロジック・overrideの
 * 適用方法を変えたら必ずインクリメントする。monthlyCashFlowSnapshotsはこの値が
 * 保存済みスナップショットと異なる場合は「旧ロジック」として表示し、次回の更新
 * (定時Job/手動更新ボタン)で再計算させる(ユーザー確定、2026-09-18。v3で、仕訳帳エクスポートが
 * 重く非同期のため、ページ表示時の自動再計算ではなく更新操作での再計算に変更、2026-09-19)。
 *
 * v3(2026-09-19): 外部入金を銀行明細ベースから、仕訳帳の相手科目による区分(営業・借入・
 * 保険資産回収等・その他・未分類、cashInflow.ts)へ変更。外部支出はv2のまま。
 */
export const EXTERNAL_CASH_FLOW_CALCULATION_VERSION = "external-cashflow-v3-2026-09-19";

export type ExternalCashFlowStatus = "provisional" | "final";

export interface ExternalCashFlowResult {
  externalIncome: number;
  externalExpenseTotal: number;
  /** 公式transfers(受取先の実額=to_walletables[].amountで照合)によりincome側から控除した件数・金額 */
  officialTransferIncomeMatchCount: number;
  officialTransferIncomeMatchTotal: number;
  /** 公式transfers(送金元の額面=transfer.amountで照合、手数料は受取側でのみ発生するため送金元は額面のまま)によりexpense側から控除した件数・金額 */
  officialTransferExpenseMatchCount: number;
  officialTransferExpenseMatchTotal: number;
  /** 適用された(confidence=confirmedかつこの期間内に対象wallet_txnが実在する)overrideのID */
  appliedOverrideIds: string[];
  appliedOverrideIncomeTotal: number;
  appliedOverrideExpenseTotal: number;
  /** この期間内に対象wallet_txnが実在する未解決明細(控除はしない、提示のみ) */
  unresolvedItems: UnresolvedCashFlowItem[];
  /** この期間内に対象wallet_txnが実在するconfidence=tentativeのoverride候補(控除はしない、提示のみ) */
  tentativeCandidates: ExternalCashFlowOverride[];
  status: ExternalCashFlowStatus;
  calculationVersion: string;
}

interface MatchKeyed {
  date: string;
  walletableType: string;
  walletableId: number;
  amount: number;
}

function matchKey(k: MatchKeyed): string {
  return `${k.date}|${k.walletableType}|${k.walletableId}|${k.amount}`;
}

/**
 * income側の公式transferマッチング。受取先の実額(transfer.to_walletables[].amount)で照合する。
 * transfer.amount(送金元の額面)をそのまま使うと、受取側で手数料が差し引かれるケース
 * (例: 電子債権の資金化)を取りこぼす(49期実績で3件・¥4,014,670の差、2026-09-18確認済み)。
 * 同一(date, walletable, amount)が複数存在する場合に備え、1:1消費マッチングで
 * 二重マッチを防ぐ。
 */
function matchOfficialTransferIncome(
  cashIncome: FreeeWalletTxn[],
  transfers: FreeeTransfer[]
): { matchedIds: Set<number>; total: number } {
  const available = new Map<string, number>();
  for (const t of transfers) {
    for (const leg of t.to_walletables ?? []) {
      const key = matchKey({ date: t.date, walletableType: leg.type, walletableId: leg.id, amount: leg.amount });
      available.set(key, (available.get(key) ?? 0) + 1);
    }
  }

  const matchedIds = new Set<number>();
  let total = 0;
  for (const w of cashIncome) {
    const key = matchKey({ date: w.date, walletableType: w.walletable_type, walletableId: w.walletable_id, amount: w.amount });
    const count = available.get(key) ?? 0;
    if (count > 0) {
      available.set(key, count - 1);
      matchedIds.add(w.id);
      total += w.amount;
    }
  }
  return { matchedIds, total };
}

/**
 * expense側の公式transferマッチング。送金元は手数料が発生しないため、額面(transfer.amount)を
 * そのまま(date, from_walletable, amount)で照合する。
 */
function matchOfficialTransferExpense(
  cashExpense: FreeeWalletTxn[],
  transfers: FreeeTransfer[]
): { matchedIds: Set<number>; total: number } {
  const available = new Map<string, number>();
  for (const t of transfers) {
    const key = matchKey({
      date: t.date,
      walletableType: t.from_walletable_type,
      walletableId: t.from_walletable_id,
      amount: t.amount,
    });
    available.set(key, (available.get(key) ?? 0) + 1);
  }

  const matchedIds = new Set<number>();
  let total = 0;
  for (const w of cashExpense) {
    const key = matchKey({ date: w.date, walletableType: w.walletable_type, walletableId: w.walletable_id, amount: w.amount });
    const count = available.get(key) ?? 0;
    if (count > 0) {
      available.set(key, count - 1);
      matchedIds.add(w.id);
      total += w.amount;
    }
  }
  return { matchedIds, total };
}

/**
 * 指定期間の外部入金・外部支出を、恒久ロジック(口座境界+公式transfer実額照合)＋
 * 証拠付きoverride(EXTERNAL_CASH_FLOW_OVERRIDES)で計算する。
 *
 * cashIncome/cashExpenseは、呼び出し側で既に口座境界(isCashWalletable)と対象期間の
 * 日付範囲でフィルタ済みのwallet_txnsを渡すこと。override/未解決明細/tentative候補は、
 * 対象wallet_txn IDがこの引数の中に実在するものだけをこの期間の結果として扱う
 * (期間ごとの日付範囲判定をこのファイルで再実装しない、ユーザー確定、2026-09-18)。
 */
export function computeExternalCashFlow(
  companyId: number,
  cashIncome: FreeeWalletTxn[],
  cashExpense: FreeeWalletTxn[],
  transfers: FreeeTransfer[]
): ExternalCashFlowResult {
  const grossIncome = cashIncome.reduce((s, w) => s + w.amount, 0);
  const grossExpense = cashExpense.reduce((s, w) => s + w.amount, 0);

  const officialIncome = matchOfficialTransferIncome(cashIncome, transfers);
  const officialExpense = matchOfficialTransferExpense(cashExpense, transfers);

  const incomeIdsInPeriod = new Set(cashIncome.map((w) => w.id));
  const expenseIdsInPeriod = new Set(cashExpense.map((w) => w.id));

  const applicableOverrides = EXTERNAL_CASH_FLOW_OVERRIDES.filter(
    (o) => o.companyId === companyId && incomeIdsInPeriod.has(o.incomeWalletTxnId)
  );

  let appliedOverrideIncomeTotal = 0;
  let appliedOverrideExpenseTotal = 0;
  const appliedOverrideIds: string[] = [];
  for (const o of applicableOverrides) {
    appliedOverrideIncomeTotal += o.amount;
    appliedOverrideIds.push(o.id);
    if (o.expenseWalletTxnId !== undefined && expenseIdsInPeriod.has(o.expenseWalletTxnId)) {
      appliedOverrideExpenseTotal += o.amount;
    }
  }

  const unresolvedItems = EXTERNAL_CASH_FLOW_UNRESOLVED_ITEMS.filter(
    (item) =>
      item.companyId === companyId &&
      (item.side === "income" ? incomeIdsInPeriod : expenseIdsInPeriod).has(item.walletTxnId)
  );

  const tentativeCandidates = EXTERNAL_CASH_FLOW_TENTATIVE_CANDIDATES.filter(
    (o) => o.companyId === companyId && incomeIdsInPeriod.has(o.incomeWalletTxnId)
  );

  const status: ExternalCashFlowStatus =
    unresolvedItems.length > 0 || tentativeCandidates.length > 0 || appliedOverrideIds.length > 0
      ? "provisional"
      : "final";

  return {
    externalIncome: grossIncome - officialIncome.total - appliedOverrideIncomeTotal,
    externalExpenseTotal: grossExpense - officialExpense.total - appliedOverrideExpenseTotal,
    officialTransferIncomeMatchCount: officialIncome.matchedIds.size,
    officialTransferIncomeMatchTotal: officialIncome.total,
    officialTransferExpenseMatchCount: officialExpense.matchedIds.size,
    officialTransferExpenseMatchTotal: officialExpense.total,
    appliedOverrideIds,
    appliedOverrideIncomeTotal,
    appliedOverrideExpenseTotal,
    unresolvedItems,
    tentativeCandidates,
    status,
    calculationVersion: EXTERNAL_CASH_FLOW_CALCULATION_VERSION,
  };
}
