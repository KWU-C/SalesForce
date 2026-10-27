/**
 * 月次業績・採算(50期の経営タブ改定、ユーザー確定 2026-10-27)で使う勘定科目・品目・取引先の定義。
 * 名前はfreeeの試算表(trial_pl・trial_cr)に出る名前そのもの。49期の決算書と一致することを確認済み。
 */

/** 外注加工費。決算書の「外注加工費」と一致させる(製造経費の[製]外注加工費だけ) */
export const OUTSOURCING_ACCOUNT = "[製]外注加工費";

/** 外注加工費とは別の項目として表示する(決算書では外注加工費に含まれない) */
export const MANUFACTURING_CONSIGNMENT_ACCOUNT = "[製]業務委託費";

/**
 * 建物関連費用の候補科目。このうち品目が BUILDING_ITEM_PREFIX で始まるものだけを建物関連費用とする。
 * [製]賃借料には複合機・PC等のリース料が含まれるため、科目の全額は入れない(ユーザー確定)。
 * 品目が「未選択」の金額は建物関連費用に入れず、件数・金額を別に示す(根拠なく含めない)。
 */
export const BUILDING_CANDIDATE_ACCOUNTS: readonly string[] = [
  "[製]地代家賃",
  "[製]賃借料",
  "賃借料・地代家賃",
  "賃借料",
  "修繕費",
];

/** 建物の地代・家賃と識別できる品目の名前の先頭。49期の品目(ギャラリー・芦屋オフィス・東京オフィス・淀屋橋)で確認 */
export const BUILDING_ITEM_PREFIX = "【地代・家賃】";

/**
 * マザー関連支出の取引先(有限会社ティーシーディマザー)。名前の変更に左右されないようfreeeの取引先IDで識別する。
 * 費用科目すべて(地代家賃・業務委託費など)を集計する。マザーからの雑収入は支出と相殺せず、営業外収益のまま扱う。
 */
export const MOTHER_PARTNER_ID = 109729525;

/** マザー関連支出の集計対象とする費用の区分(trial_pl・trial_crのaccount_category_name) */
export const EXPENSE_CATEGORIES_PL: readonly string[] = ["販売管理費", "営業外費用", "特別損失"];
export const EXPENSE_CATEGORIES_CR: readonly string[] = ["労務費", "製造経費"];

/** 仕掛品振替の有無を見る科目。その月にこの科目の借方・貸方の発生があれば「反映あり」 */
export const WIP_CLOSING_ACCOUNT = "[製]期末仕掛品";
