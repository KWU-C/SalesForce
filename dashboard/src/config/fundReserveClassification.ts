/**
 * 「資金の備え」セクションにおける、freeeのwalletable(口座) → 目的区分のマッピング設定。
 * 集計ロジック・UIへ口座IDを直書きせず、ここに一元化する(ユーザー確定、2026-09-15)。
 * ここを書き換えるだけで、集計ロジック・UIを変更せずに口座の分類を変更できる
 * (例: 将来「その他目的資金」→「賞与準備」への変更)。
 */

export type FundReservePurpose = "bonus" | "insurance" | "other";

export interface WalletablePurposeMapping {
  walletableId: number;
  purpose: FundReservePurpose;
  /** UI表示名。freeeの口座名をそのまま出さず、目的が分かる独自ラベルを持たせる */
  label: string;
}

/**
 * 「資金の備え」の対象として扱うfreee walletable一覧。
 *
 * 「定期預金_尼信1012積立」(walletableId=4582561)は、2026-09-15の調査で以下を確認済み:
 * - 通常の運転資金口座とは別建ての定期預金口座で、2026年7月末から月末ごとに資金移動が発生している
 * - freee上には「賞与用」等の目的を示すタグ・摘要・部門情報が一切無い
 * 用途がfreee側からもTCD側からも確認できていないため、賞与用と決めつけず
 * "other"(その他目的資金)として扱う(ユーザー確定、2026-09-15)。用途が確認でき次第、
 * このマッピングのpurposeを書き換えるだけでよい(集計ロジック・UI側の変更は不要)。
 */
export const WALLETABLE_PURPOSE_MAP: readonly WalletablePurposeMapping[] = [
  { walletableId: 4582561, purpose: "other", label: "その他目的資金（定期預金_尼信1012積立）" },
];

/**
 * 賞与準備は、対象口座または目標額がTCD側で確定するまで常に「未設定」と表示する
 * (ユーザー確定、2026-09-15。会計上の「賞与引当金」は発生主義の見積り計上であり、
 * 実キャッシュの準備額ではないため推測で数字を出さない)。
 * WALLETABLE_PURPOSE_MAPにpurpose:"bonus"の口座が追加された時点で、
 * このフラグをtrueにすると自動的に金額表示へ切り替わる。
 */
export const BONUS_RESERVE_CONFIGURED = false;
