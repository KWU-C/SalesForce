/**
 * 試算表(trial_bs)の「現金・預金」科目 → 預金の種類の分類ルール(ユーザー確定、2026-10-21)。
 * 経理の資金繰り予定(当座・普通預金合計/定期預金)とfreeeの月末実績を比べるためだけに使う。
 * 集計ロジック・UIへ科目名を直書きせず、ここに一元化する(fundReserveClassificationと同じ方針)。
 *
 * freeeの科目名は「当座預金_銀行/支店 口座番号」「普通預金_…」「定期預金_…」「現金」の形
 * (2026-10-21にfreee実データの科目名で確認、13科目すべてがいずれかに当たる)。
 * どのルールにも当たらない科目はどの種類にも入れない。その場合は3種類の合計が月末現預金と
 * 合わなくなり、画面に警告が出る(推測で振り分けない)。
 *
 * - checkingSavings: 当座・普通預金。経理の「当座・普通預金合計」と比べる
 * - timeDeposit: 定期預金(担保差入の定期を含む。経理の定期預金も担保控除前の値)
 * - cashOnHand: 現金(小口現金)。経理の予定には対応する項目が無いので、比較差額には含めない
 */
export type CashAccountKind = "checkingSavings" | "timeDeposit" | "cashOnHand";

export interface CashAccountKindRule {
  kind: CashAccountKind;
  /** 科目名がこのいずれかで始まれば該当 */
  namePrefixes?: readonly string[];
  /** 科目名がこのいずれかと完全一致すれば該当 */
  exactNames?: readonly string[];
}

export const CASH_ACCOUNT_KIND_RULES: readonly CashAccountKindRule[] = [
  { kind: "checkingSavings", namePrefixes: ["当座預金", "普通預金"] },
  { kind: "timeDeposit", namePrefixes: ["定期預金"] },
  { kind: "cashOnHand", exactNames: ["現金"] },
];

export function classifyCashAccount(
  accountItemName: string,
  rules: readonly CashAccountKindRule[] = CASH_ACCOUNT_KIND_RULES
): CashAccountKind | null {
  const rule = rules.find(
    (r) =>
      r.exactNames?.includes(accountItemName) ||
      r.namePrefixes?.some((prefix) => accountItemName.startsWith(prefix))
  );
  return rule?.kind ?? null;
}
