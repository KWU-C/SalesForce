/**
 * 入金側v3(2026-09-19)の分類ルール設定。仕訳帳(freee `/api/1/journals` CSVエクスポート)の
 * 「現金・預金の借方行」を、同じ伝票内の相手科目で分類するための科目集合と、49期(freee移行期)
 * 固有の証拠付き補完リスト。分類ロジック本体は features/management-dashboard/cashInflow.ts。
 *
 * 検証の経緯: output/claude49-verify/REPORT.md(2026-09-19)。仕訳帳は試算表BSの現金・預金
 * 全14科目の借方/貸方合計と1円単位で一致することを確認済み(=帳簿の完全な写し)。
 */

export type CashInflowCategory = "operating" | "borrowing" | "assetRecovery" | "other" | "unclassified";

/**
 * 営業入金とみなす相手科目(貸方)の account_items.account_category。
 * 売掛金・受取手形・電子債権を同じ「売上債権」範囲で扱い、債権間の振替を入金にしない。
 * 「売上高」直接計上(現金売上)も、売上代金の実入金であるため営業入金に含める。
 * 科目名のハードコードを避けるため、勘定科目マスタのカテゴリで判定する
 * (49期に「受取手形・電子債権」が新設されて期末残高が漏れた再発防止)。
 */
export const OPERATING_ACCOUNT_CATEGORIES: readonly string[] = ["売上債権", "売上高"];

/** 売上債権カテゴリのうち営業入金の相手科目にしない科目(評価性の引当金) */
export const NON_OPERATING_RECEIVABLE_ACCOUNTS: readonly string[] = ["貸倒引当金(売)"];

/** 科目名で営業入金に加える相手科目(顧客からの前受入金) */
export const OPERATING_EXTRA_ACCOUNTS: readonly string[] = ["前受金"];

/** 借入による入金とみなす相手科目の科目名の末尾(長期借入金・短期借入金・役員借入金) */
export const BORROWING_ACCOUNT_SUFFIX = "借入金";

/** 保険・資産回収等とみなす相手科目のカテゴリ(保険積立金・敷金・出資金・固定資産売却など) */
export const ASSET_RECOVERY_ACCOUNT_CATEGORIES: readonly string[] = [
  "投資その他の資産",
  "有形固定資産",
  "無形固定資産",
  "有価証券",
];

/**
 * その他入金(還付・補助金・利息・雑収入・立替返金等)とみなす相手科目のカテゴリ。
 * 損益科目への貸方は、売上債権の回収でも借入でもない収益・費用戻りとして「その他」に置く。
 */
export const OTHER_INFLOW_ACCOUNT_CATEGORIES: readonly string[] = [
  "営業外収益",
  "特別利益",
  "営業外費用",
  "特別損失",
  "販売管理費",
  "製造経費",
  "労務費",
  "法人税等",
  "法人税等調整額",
];

/** 科目名で「その他」とみなす貸借対照表科目(立替・未収・預り金の精算) */
export const OTHER_INFLOW_ACCOUNTS: readonly string[] = ["未収入金", "立替金", "預り金"];

/**
 * 上記のいずれにも該当しない相手科目(仮受金・仮払金・未確定勘定など性質が判定できない科目)は
 * 「未分類」に置く。「その他」へ自動的に押し込まない(推測で分類しない、ユーザー確定)。
 */

/** 仕訳帳上、複合仕訳の中間科目(実際の相手科目は同じ伝票の別の行にある)。相手科目として数えない */
export const COMPOUND_PLACEHOLDER_ACCOUNT = "複合";

/** 仕訳帳CSVで現金・預金を表す科目名(補助科目=口座名=walletable名) */
export const CASH_JOURNAL_ACCOUNT = "現金及び預金";

/**
 * 入金時に相手方が差し引いた手数料・源泉税等を、別伝票で「現金貸方」として記帳している場合の
 * 非現金借方科目。銀行には純額の入金1本しか現れないため、営業入金から差し引く(総額/純額の正規化)。
 */
export const AT_SOURCE_DEDUCTION_DEBIT_ACCOUNTS: readonly string[] = ["仮払税金", "支払手数料", "手形売却損"];

/** 差引伝票を入金伝票へ結び付ける際、摘要末尾(銀行摘要)が一致していなければならない最小文字数 */
export const AT_SOURCE_DEDUCTION_MEMO_SUFFIX_MIN_LENGTH = 8;

const COMPANY_ID = 11314786;

/**
 * 銀行明細フィードに存在しない営業入金の、帳簿による補完(49期固有、confidence=confirmed)。
 * 尼信当座3032の銀行明細取得は2025-10-30以降のため、それ以前の営業回収3件が明細に無い。
 * 仕訳帳の同日・同口座・同額の借方行が存在するものだけを補完として印付けする(合計は
 * 営業入金の内数で、二重加算ではない。表示上「うち帳簿補完」として区別するためのリスト)。
 * 後日フィードに同じ入金が入っても、分類は仕訳帳ベースのため二重計上にならない。
 */
export interface LedgerOnlyOperatingReceipt {
  id: string;
  companyId: number;
  date: string;
  walletableId: number;
  amount: number;
  evidence: string;
}

export const LEDGER_ONLY_OPERATING_RECEIPTS: LedgerOnlyOperatingReceipt[] = [
  {
    id: "term49-ledger-only-20250910-toyosu",
    companyId: COMPANY_ID,
    date: "2025-09-10",
    walletableId: 4469149,
    amount: 407_825,
    evidence: "電子債権満期資金化(とよす)。借)尼信当座3032/貸)受取手形。尼信当座の銀行明細は2025-10-30以降のみ",
  },
  {
    id: "term49-ledger-only-20250930-nichiban",
    companyId: COMPANY_ID,
    date: "2025-09-30",
    walletableId: 4469149,
    amount: 866_525,
    evidence: "電子債権満期資金化(ニチバン)。借)尼信当座3032/貸)受取手形。尼信当座の銀行明細は2025-10-30以降のみ",
  },
  {
    id: "term49-ledger-only-20251001-kawaguchi",
    companyId: COMPANY_ID,
    date: "2025-10-01",
    walletableId: 4469149,
    amount: 14_810_154,
    evidence:
      "受取手形割引入金(川口技研、額面14,910,500−割引料99,246−手数料1,100、期日R8/1/21、取扱番号538315)。借)尼信当座3032/貸)受取手形。同額の銀行明細は49期全口座に存在しない",
  },
];

/**
 * 銀行明細には存在するが帳簿に一切計上されていない、同日・同口座・同額の入金/出金の往復
 * (49期固有)。仕訳帳ベースの入金集計には最初から現れないため、金額の控除は不要。
 * 参考表示(「除外した往復」)のためにIDで保持する。性質(当座貸越の書換か銀行側の取消・
 * 再入力か)は未確定のまま分類しない(ユーザー確定、2026-09-19)。
 */
export interface NetZeroRoundTrip {
  id: string;
  companyId: number;
  amount: number;
  date: string;
  incomeWalletTxnId: number;
  expenseWalletTxnId: number;
  evidence: string;
}

export const NET_ZERO_ROUND_TRIPS: NetZeroRoundTrip[] = [
  {
    id: "term49-net-zero-20251031-50000000",
    companyId: COMPANY_ID,
    amount: 50_000_000,
    date: "2025-10-31",
    incomeWalletTxnId: 2045158083,
    expenseWalletTxnId: 2045158085,
    evidence:
      "りそな当座1518826、摘要「0951272」、双方status=3(無視)。49期の仕訳帳に金額50,000,000の行が借方・貸方とも存在しない。営業売上の証拠なし。摘要の照会は人手確認",
  },
];
