/**
 * 「資金の備え」セクションにおける、freeeのwalletable(口座) → 目的区分のマッピング設定。
 * 集計ロジック・UIへ口座IDを直書きせず、ここに一元化する(ユーザー確定、2026-09-15)。
 * ここを書き換えるだけで、集計ロジック・UIを変更せずに口座の分類を変更できる。
 */

/**
 * - collateral: 借入の担保として差し入れている預金(自由に引き出せない)
 * - tax: 納税資金を分けて置いている口座
 * - other: 用途がfreeeからもTCD側からも確認できていない積立
 */
export type FundReservePurpose = "collateral" | "tax" | "other";

export interface WalletablePurposeMapping {
  walletableId: number;
  purpose: FundReservePurpose;
  /** UI表示名。freeeの口座名をそのまま出さず、目的が分かる独自ラベルを持たせる */
  label: string;
}

/**
 * 「現預金の内訳」で、通常の運転資金口座と分けて示すfreee walletable一覧
 * (経理報告「残高表銀行」との照合に基づく、ユーザー確定 2026-10-05)。
 *
 * - 4469155「定期預金_尼信/打出 2004」: 経理報告に「当座貸越3,000万の担保」と注記のある定期預金
 * - 4469154「普通預金_尼信/打出 4059395」: 消費税の積立・中間納付に使っている専用口座。
 *   残高は経理の消費税準備額(設定値)とは一致しない(積立の振替が月末計上より遅れるため)ので、
 *   資金余力の控除には使わず、口座の実残高として内訳にだけ出す
 * - 4582561「定期預金_尼信1012積立」: 月末ごとに積み立てているが用途は未確認のため"other"
 *
 * 「定期預金_りそな/西宮 3075920」(4469156)も月末ごとに積み立てているが、用途が確認できるまで
 * ここには入れない(ユーザー確定、2026-10-05)。
 */
export const WALLETABLE_PURPOSE_MAP: readonly WalletablePurposeMapping[] = [
  { walletableId: 4469155, purpose: "collateral", label: "担保差入（尼信定期・当座貸越担保）" },
  { walletableId: 4469154, purpose: "tax", label: "消費税納税用口座" },
  { walletableId: 4582561, purpose: "other", label: "その他目的資金（定期預金_尼信1012積立）" },
];
