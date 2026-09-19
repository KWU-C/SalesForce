/**
 * 外部入金・外部支出(月次資金収支)の「恒久ロジック」だけでは判定できない、
 * 個別取引ごとのoverride記録。
 *
 * 【背景、2026-09-18】恒久ロジック(cashAccountBoundary + 公式transferの受取先実額照合、
 * externalCashFlow.ts参照)を適用しても、freeeのtransfers APIに登録されていない
 * 自社口座間の資金移動(振替)は検出できない。49期はfreee移行期にあたり、この種の
 * 「非公式な内部振替」が複数件確認された(output/freee49-audit/REPORT.md、通称Codex
 * レポートによる、仕訳(manual_journals)の貸借照合で1件ずつ裏取り済み)。
 *
 * 恒久ロジックにハードコードするのではなく、このファイルにID・根拠・confidence付きの
 * 個別レコードとして保持する(ユーザー確定、2026-09-18)。50期以降は公式transfer照合と
 * 口座境界だけで通常は足りるはずで、このファイルへの追記は例外対応という位置づけ。
 *
 * confidence="confirmed"のみが実際にexternalIncome/externalExpenseTotalから控除される。
 * "tentative"は控除せず、参考情報として個別に提示するだけに留める
 * (「未解決明細は無理に分類・補正しない」ユーザー確定、2026-09-18)。
 */

export type ExternalCashFlowOverrideConfidence = "confirmed" | "tentative";

export interface ExternalCashFlowOverride {
  /** override記録自体の安定ID(git上で追跡しやすいようkebab-case) */
  id: string;
  companyId: number;
  /** 内部振替と判定する金額(income側から控除する額と同額をexpense側からも控除する) */
  amount: number;
  /** 集計対象月の判定に使う日付(income側wallet_txnの計上日) */
  date: string;
  /** income側のwallet_txn ID(必須。これが無いと期間内判定ができない) */
  incomeWalletTxnId: number;
  /** expense側のwallet_txn ID。対応するexpense側の記帳が存在しない場合はundefined
   * (例: 定期預金解約のように、原資側がfreeeのwalletable外で管理されているケース) */
  expenseWalletTxnId?: number;
  confidence: ExternalCashFlowOverrideConfidence;
  /** 根拠(仕訳番号・摘要など、人が読んで検証できる形で残す) */
  evidence: string;
  /** 参考: 対応する仕訳(manual_journals)のID。無い場合はundefined */
  journalId?: number;
  /** income側記帳日と仕訳日のズレ(日数)。0が大半だが、給与資金等で数日ずれる実例がある */
  dateGapDays?: number;
}

const COMPANY_ID = 11314786;

/**
 * 49期(2025-09-01〜2026-08-31)、confidence="confirmed"のoverride。
 * 全件、output/freee49-audit/summary.json の pairs(9件、仕訳の貸借照合で単一の
 * journal_matchが取れたもの)＋積金の元本/利息分割(1件)。金額の1円単位までCodexレポートの
 * verify.py実行結果と一致することを2026-09-18に実データで再検証済み。
 */
export const EXTERNAL_CASH_FLOW_OVERRIDES: ExternalCashFlowOverride[] = [
  {
    id: "term49-pair-20251223-3600000",
    companyId: COMPANY_ID,
    amount: 3_600_000,
    date: "2025-12-23",
    incomeWalletTxnId: 2045158095,
    expenseWalletTxnId: 2045104540,
    confidence: "confirmed",
    evidence: "資金移動　りそな私募債償還、定期預金資金",
    journalId: 3295201690,
    dateGapDays: 0,
  },
  {
    id: "term49-pair-20251223-1300000",
    companyId: COMPANY_ID,
    amount: 1_300_000,
    date: "2025-12-23",
    incomeWalletTxnId: 2045126234,
    expenseWalletTxnId: 2045104542,
    confidence: "confirmed",
    evidence: "資金移動　消費税積立12月分",
    journalId: 3295201696,
    dateGapDays: 0,
  },
  {
    id: "term49-pair-20251223-2000000",
    companyId: COMPANY_ID,
    amount: 2_000_000,
    date: "2025-12-23",
    incomeWalletTxnId: 2045113144,
    expenseWalletTxnId: 2045104541,
    confidence: "confirmed",
    evidence: "資金移動　尼信借入金返済、定期預金資金",
    journalId: 3295201694,
    dateGapDays: 0,
  },
  {
    id: "term49-pair-20251127-600000",
    companyId: COMPANY_ID,
    amount: 600_000,
    date: "2025-11-27",
    incomeWalletTxnId: 2045158090,
    expenseWalletTxnId: 2045104467,
    confidence: "confirmed",
    evidence: "資金移動　りそな定期預金資金",
    journalId: 3295200484,
    dateGapDays: 0,
  },
  {
    id: "term49-pair-20251112-13000000",
    companyId: COMPANY_ID,
    amount: 13_000_000,
    date: "2025-11-12",
    incomeWalletTxnId: 2045104424,
    expenseWalletTxnId: 2045158088,
    confidence: "confirmed",
    evidence: "【資金移動】　給与資金　※りそな/西宮/当座→三井住友/芦屋駅前/当座(仕訳日は11/18、銀行記帳日11/12を期間判定に使う)",
    journalId: 3295200273,
    dateGapDays: 6,
  },
  {
    id: "term49-pair-20251107-5000000",
    companyId: COMPANY_ID,
    amount: 5_000_000,
    date: "2025-11-07",
    incomeWalletTxnId: 2045104405,
    expenseWalletTxnId: 2045158086,
    confidence: "confirmed",
    evidence: "【資金移動】　運転資金　※りそな/西宮/当座→三井住友/芦屋駅前/当座",
    journalId: 3295200011,
    dateGapDays: 0,
  },
  {
    id: "term49-pair-20251104-4474339",
    companyId: COMPANY_ID,
    amount: 4_474_339,
    date: "2025-11-04",
    incomeWalletTxnId: 2045113123,
    expenseWalletTxnId: 2045126232,
    confidence: "confirmed",
    evidence: "【資金移動】　消費税納税　※尼信/打出/普通→尼信/打出/当座",
    journalId: 3295199849,
    dateGapDays: 0,
  },
  {
    id: "term49-pair-20251030-4650000",
    companyId: COMPANY_ID,
    amount: 4_650_000,
    date: "2025-10-30",
    incomeWalletTxnId: 2045126229,
    expenseWalletTxnId: 2045113118,
    confidence: "confirmed",
    evidence: "資金移動　納税資金",
    journalId: 3295199221,
    dateGapDays: 0,
  },
  {
    id: "term49-pair-20251030-5000000",
    companyId: COMPANY_ID,
    amount: 5_000_000,
    date: "2025-10-30",
    incomeWalletTxnId: 2045104361,
    expenseWalletTxnId: 2045113119,
    confidence: "confirmed",
    evidence: "資金移動　運転資金",
    journalId: 3295199225,
    dateGapDays: 0,
  },
  {
    id: "term49-pair-20250908-2000000",
    companyId: COMPANY_ID,
    amount: 2_000_000,
    date: "2025-09-08",
    incomeWalletTxnId: 2045104229,
    // 出金側(尼信当座3032)は銀行明細フィード開始(2025-10-30)前のため明細が無い。仕訳帳で両側を確認済み
    confidence: "confirmed",
    evidence:
      "資金移動　運転資金　尼信→三井住友。仕訳帳(2025-09-05): 借)三井住友当座2,000,000/貸)尼信当座3032 2,000,000。銀行記帳日は9/08(3日差)",
    journalId: 3295197624,
    dateGapDays: 3,
  },
  {
    id: "term49-pair-20250917-20000000",
    companyId: COMPANY_ID,
    amount: 20_000_000,
    date: "2025-09-17",
    incomeWalletTxnId: 2045104253,
    // 出金側(りそな当座)は銀行明細フィード開始(2025-10-31)前のため明細が無い。仕訳帳で両側を確認済み
    confidence: "confirmed",
    evidence:
      "資金移動　給与資金　りそな→三井住友。仕訳帳(2025-09-18): 借)三井住友当座20,000,000/貸)りそな当座1518826 20,000,000。銀行記帳日は9/17(1日差)",
    journalId: 3295197821,
    dateGapDays: -1,
  },
  {
    id: "term49-split-20251203-tsumikin-principal",
    companyId: COMPANY_ID,
    amount: 6_000_000,
    date: "2025-12-03",
    incomeWalletTxnId: 2045126233,
    // 定期預金(積金)解約の原資側はfreeeのwalletable外のため、expense側の対応レコードは無い
    confidence: "confirmed",
    evidence:
      "積金(定期預金)解約。入金額6,003,541円のうち元本6,000,000円のみ内部振替、利息3,541円(税引後、額面4,181円)は外部入金として残す",
    dateGapDays: 0,
  },
];

/**
 * confidence="tentative"のoverride候補。現在は無し(2026-09-19、49期の2件は仕訳帳の貸借で確定し
 * EXTERNAL_CASH_FLOW_OVERRIDESへ昇格した)。将来、仕訳側の証拠はあるが銀行出金が1:1で
 * 対応付けられない候補が出たら、確定するまでここに置く(externalExpenseTotalには反映しない)。
 */
export const EXTERNAL_CASH_FLOW_TENTATIVE_CANDIDATES: ExternalCashFlowOverride[] = [];

export type UnresolvedCashFlowSide = "income" | "expense";

export interface UnresolvedCashFlowItem {
  id: string;
  companyId: number;
  walletTxnId: number;
  side: UnresolvedCashFlowSide;
  amount: number;
  date: string;
  reason: string;
}

/**
 * 内部振替かどうか判定できず、かつ無理に外部入金として確定扱いもしない、個別の
 * 未解決明細。raw income/expenseからは控除しない(=現行どおり外部入金に残る)が、
 * スナップショット上で常に別枠として提示する(「未解決明細は無理に分類・補正しない」
 * ユーザー確定、2026-09-18)。
 */
export const EXTERNAL_CASH_FLOW_UNRESOLVED_ITEMS: UnresolvedCashFlowItem[] = [
  {
    id: "term49-unresolved-20251031-50000000",
    companyId: COMPANY_ID,
    walletTxnId: 2045158083,
    side: "income",
    amount: 50_000_000,
    date: "2025-10-31",
    reason:
      "りそな/西宮、摘要「0951272」。同日・同口座・同額・同摘要の入金/出金の往復(双方status=3)。49期の仕訳帳に金額50,000,000の行が無く帳簿未計上。入金側v3の集計(仕訳帳ベース)には現れず、参考表示(ネットゼロ往復)として別掲する。性質は未確定で摘要の照会は人手確認。外部支出(v2)には残っている(支出側は別途監査)",
  },
];
