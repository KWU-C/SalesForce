/**
 * freeeの勘定科目名 → TCD Dashboard独自の「会社版家計簿」支出区分へのマッピング設定。
 * UIコンポーネントへ直書きせず、ここで一元管理する(ユーザー確定、2026-09-14)。
 *
 * 2026年8月の実データ(deals・wallet_txns・transfers)で検証済みの区分。
 * freeeの勘定科目を完全再現するのではなく、経営判断に必要な7区分へ再分類する。
 * 同じ取引が複数区分に二重計上されないよう、1取引につき最も金額の大きい明細行の
 * 勘定科目で代表分類する(集計レベルでの実データ検証で外部支出総額の101.7%を
 * 説明できることを確認済み)。
 */
export type ExpenseCategory =
  | "labor"
  | "outsourcing"
  | "taxSocial"
  | "financing"
  | "interest"
  | "assetTransfer"
  | "otherOperating"
  | "other";

/** 通常運営(営業キャッシュ収支に含める)か、財務・将来準備(区別して表示)かの分類 */
export const OPERATING_CATEGORIES: readonly ExpenseCategory[] = [
  "labor",
  "outsourcing",
  "taxSocial",
  "otherOperating",
  "other",
];
/**
 * financing(借入元本返済)とinterest(支払利息)は、借入残高の減少(元本)と
 * 借入コスト(利息)を別々に見られるよう分離する(ユーザー確定、2026-09-15)。
 * 支払利息を通常の諸経費(otherOperating/other)へ混ぜない。
 */
export const FINANCING_AND_RESERVE_CATEGORIES: readonly ExpenseCategory[] = [
  "financing",
  "interest",
  "assetTransfer",
];

const LABOR_ITEMS: readonly string[] = [
  "役員報酬",
  "役員賞与",
  "給料手当",
  "[製]給料手当",
  "賞与",
  "雑給",
  "[製]雑給",
  "未払金",
];

// 「外注費」は今期使われておらず、実際の計上は「業務委託費」(実データで確認済み)
const OUTSOURCING_ITEMS: readonly string[] = [
  "業務委託費",
  "[製]業務委託費",
  "外注費",
  "外注加工費",
  "[製]外注加工費",
];

const TAX_SOCIAL_ITEMS: readonly string[] = [
  "預り金",
  "法定福利費",
  "[製]法定福利費",
  "仮払税金",
  "法人税等",
  "未払法人税等",
  "未払消費税等",
  "租税公課",
];

const FINANCING_ITEMS: readonly string[] = ["短期借入金", "長期借入金", "役員借入金"];

// 借入コスト(元本ではない)。実データ確認済み(2026-09-15): 1つのdeal内に借入金(元本)と
// 支払利息が別明細行で計上されるケースがあり、金額の大きい元本行が代表科目に選ばれるため、
// 単純な代表科目分類だけでは利息が借入元本返済に混入する。monthlyCashFlow.ts側で
// この科目を検出し、deal明細の金額比で元本・利息にpayment.amountを按分する
const INTEREST_ITEMS: readonly string[] = ["支払利息"];

// 積立・資産移動: 現金は出るが費用ではなく資産へ振り替わるもの
const ASSET_TRANSFER_ITEMS: readonly string[] = ["保険積立金", "前払費用"];

// 諸経費: 通常の運営経費(ホワイトリスト)。ここに無い科目は「その他」扱い
const OTHER_OPERATING_ITEMS: readonly string[] = [
  "賃借料・地代家賃",
  "賃借料",
  "地代家賃",
  "[製]賃借料",
  "リース料",
  "通信費",
  "[製]通信費",
  "保険料",
  "福利厚生費",
  "[製]福利厚生費",
  "水道光熱費",
  "[製]水道光熱費",
  "修繕費",
  "消耗品費",
  "[製]消耗品費",
  "事務用品費",
  "[製]事務用品費",
  "雑費",
  "[製]雑費",
  "広告宣伝費",
  "諸会費",
  "顧問料",
  "新聞図書費",
  "[製]新聞図書費",
  "人材採用費",
  "[製]人材採用費",
  "支払手数料",
  "支払報酬料",
  "旅費交通費",
  "[製]旅費交通費",
  "出張旅費",
  "[製]出張旅費",
  "交際費",
  "会議費",
  "車両費",
  "研修費",
  "荷造運賃",
];

export function classifyExpenseAccountItem(accountItemName: string): ExpenseCategory {
  if (LABOR_ITEMS.includes(accountItemName)) return "labor";
  if (OUTSOURCING_ITEMS.includes(accountItemName)) return "outsourcing";
  if (TAX_SOCIAL_ITEMS.includes(accountItemName)) return "taxSocial";
  if (FINANCING_ITEMS.includes(accountItemName)) return "financing";
  if (INTEREST_ITEMS.includes(accountItemName)) return "interest";
  if (ASSET_TRANSFER_ITEMS.includes(accountItemName)) return "assetTransfer";
  if (OTHER_OPERATING_ITEMS.includes(accountItemName)) return "otherOperating";
  return "other";
}
