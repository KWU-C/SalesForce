/**
 * 出金側v3(2026-09-19)の分類ルール設定。仕訳帳(freee `/api/1/journals` CSV)の
 * 「現金・預金の貸方行」を、同じ伝票内の借方科目で分類する。分類ロジック本体は
 * features/management-dashboard/journalCashFlow.ts。入金側は config/cashInflowClassification.ts。
 * 区分そのもの(人件費・外注費・税金社保・借入返済・利息・積立資産移動・諸経費・その他)の科目一覧は
 * config/freeeExpenseClassification.ts。検証は output/claude49-verify/EXPENSE_AUDIT.md。
 */

/** 支払時に原因科目(費用)を辿る必要がある債務科目。未払金・買掛金の精算は、発生時の費用科目で分類する */
export const PAYABLE_ACCOUNTS: readonly string[] = ["未払金", "買掛金"];

/**
 * 勘定科目マスタ上、区分リストに載っていない科目のうち「その他」に置く損益科目のカテゴリ。
 * 区分リストにも損益カテゴリにも該当しない科目(立替金・仮払金・仮受金・未確定勘定などの
 * 貸借対照表科目)は「未分類」に置く(推測で「その他」へ押し込まない)。
 */
export const OTHER_OUTFLOW_PL_CATEGORIES: readonly string[] = [
  "販売管理費",
  "製造経費",
  "労務費",
  "営業外費用",
  "特別損失",
  "法人税等",
  "当期商品仕入",
  "営業外収益",
  "特別利益",
  "売上高",
];

/**
 * 【補助判定】債務(未払金・買掛金)の精算で、取引先(補助科目)が空欄のため原因科目を辿れない場合に
 * だけ使う摘要ルール(ユーザー確定、2026-09-19: 摘要ルールは補助判定。仕訳科目で判定できる場合は使わず、
 * どのルールにも当たらなければ未分類として露出する)。銀行取込の摘要(銀行の記載)の慣行に依存するため、
 * 50期以降で慣行が変われば未分類が増えて見える。
 */
/** 社会保険料の銀行引落(摘要に含まれる銀行記載/文言) → 税金・社会保険等 */
export const SOCIAL_INSURANCE_MEMO_TOKENS: readonly string[] = ["ｼﾔｶｲﾎｹﾝﾘﾖｳ", "社会保険料"];
/** 給与の振込(部門タグで始まり銀行記載「ﾌﾘｺﾐ」を含む摘要、または「【給与】」を含む摘要) → 人件費 */
export const PAYROLL_MEMO_DEPARTMENT_PREFIXES: readonly string[] = ["CR1 ", "CR2 ", "CR3 ", "取締役 ", "管理部 "];
export const PAYROLL_MEMO_TRANSFER_TOKEN = "ﾌﾘｺﾐ";
export const PAYROLL_MEMO_LABEL_TOKEN = "【給与】";

/**
 * 銀行明細フィードが取得できていない期間(49期固有、freee移行期)。この期間の口座の入出金は
 * 銀行明細に無く、仕訳帳(帳簿)だけが根拠になる。分類は仕訳帳ベースのため金額には影響せず、
 * 「うち帳簿補完(銀行明細欠落)」の内数として表示するために使う。
 * endDate以前はフィード無し。null=49期を通じてフィード無し(定期預金・利用の無い口座など)。
 * 根拠: output/freee49-audit/wallet_txns.json の口座別の最古の明細日(2026-09-18取得)。
 */
export interface BankFeedGap {
  walletableId: number;
  /** この日付(含む)までフィードが無い。nullは期間を通じて無し */
  endDate: string | null;
}

export const BANK_FEED_GAPS: BankFeedGap[] = [
  { walletableId: 4469145, endDate: "2026-01-18" }, // 三菱UFJ当座241532(取得開始2026-01-19)
  { walletableId: 4469148, endDate: "2025-10-30" }, // りそな当座(取得開始2025-10-31)
  { walletableId: 4469149, endDate: "2025-10-29" }, // 尼信当座3032(取得開始2025-10-30)
  { walletableId: 4469154, endDate: "2025-10-29" }, // 尼信普通4059395(取得開始2025-10-30)
  { walletableId: 4469152, endDate: "2026-02-08" }, // 尼信普通163330(取得開始2026-02-09)
  { walletableId: 4469150, endDate: null }, // 三菱UFJ普通(フィード無し)
  { walletableId: 4469151, endDate: null }, // 尼信普通158246(フィード無し)
  { walletableId: 4469153, endDate: null }, // 商工中金普通(フィード無し)
  { walletableId: 4469155, endDate: null }, // 定期預金 尼信2004
  { walletableId: 4469156, endDate: null }, // 定期預金 りそな
  { walletableId: 4469157, endDate: null }, // 定期預金 尼信1011
  { walletableId: 4582561, endDate: null }, // 定期預金 尼信1012積立
];

export function isBankFeedUnavailable(walletableId: number, date: string): boolean {
  const gap = BANK_FEED_GAPS.find((g) => g.walletableId === walletableId);
  if (!gap) return false;
  return gap.endDate === null || date <= gap.endDate;
}

/**
 * 「給与・人件費」の内訳区分(参考表示用)。仕訳の借方科目([製]付きは同名の通常科目と同じ)で決める。
 * - 役員: 役員報酬・役員賞与
 * - 従業員賞与: 賞与
 * - 退職金: 退職金
 * - 従業員給与: 上記以外の給与・人件費の科目(給料手当・雑給など)
 * 「うち従業員給与計」＝従業員給与＋従業員賞与＋指定業務委託。役員・退職金・社会保険・福利厚生費は含めない
 * (ユーザー確定、2026-09-19)。
 */
export const EXECUTIVE_PAY_ACCOUNTS: readonly string[] = ["役員報酬", "役員賞与"];
export const EMPLOYEE_BONUS_ACCOUNTS: readonly string[] = ["賞与"];
export const RETIREMENT_ACCOUNTS: readonly string[] = ["退職金"];

/** 取締役(役員)の給与振込を示す摘要の先頭タグ、および「【給与】」の現金渡し(役員報酬) */
export const EXECUTIVE_PAYROLL_MEMO_PREFIXES: readonly string[] = ["取締役 "];

/**
 * 指定業務委託(元社員で契約社員的な位置付けの3名)。経営ダッシュボード上は「外注費」ではなく
 * 「給与・人件費」に分類し、「うち従業員給与計」に含める(ユーザー確定、2026-09-19)。
 * 判定は次の2つだけで、自由記述の摘要による氏名判定は使わない(別の取引先の摘要に氏名が出るため)。
 * - 主キー: 未払金・買掛金の補助科目(=取引先名)の完全一致
 * - 副キー: 現金の直接払いでは、業務委託費の借方の補助科目(=品目名)が「【業務委託】{氏名}/」で始まる
 * 仕訳帳CSVには取引先IDが無いため照合は氏名で行う。partnerIdは記録用(freee取引先ID)。
 * 氏名が変わると一致しなくなり、その分は外注費に残る(安全側)。「日比 秀一」は別人で、氏名の完全一致で区別する。
 */
export interface DesignatedLaborContractor {
  name: string;
  partnerId: number;
}
export const DESIGNATED_LABOR_CONTRACTORS: readonly DesignatedLaborContractor[] = [
  { name: "松田徹", partnerId: 109745131 },
  { name: "福場幸司郎", partnerId: 109730300 },
  { name: "日比由美", partnerId: 109731640 },
];
export const CONTRACTOR_ITEM_PREFIX = "【業務委託】";
export const CONTRACTOR_ITEM_SEPARATOR = "/";

export function designatedContractorByPartner(partnerName: string): string | null {
  const trimmed = partnerName.trim();
  return DESIGNATED_LABOR_CONTRACTORS.find((c) => c.name === trimmed)?.name ?? null;
}

export function designatedContractorByItem(itemName: string): string | null {
  const trimmed = itemName.trim();
  return (
    DESIGNATED_LABOR_CONTRACTORS.find((c) =>
      trimmed.startsWith(`${CONTRACTOR_ITEM_PREFIX}${c.name}${CONTRACTOR_ITEM_SEPARATOR}`)
    )?.name ?? null
  );
}
