/**
 * 外部入金・外部支出(月次資金収支)の集計対象とする口座(walletable)の境界。
 *
 * 【背景、2026-09-18】従来は`type in (bank_account, wallet)`を無条件に「現金」として
 * 扱っていたが、freee実データの監査(output/freee49-audit/REPORT.md、通称Codexレポート)で
 * wallet型に「受取手形・電子債権」「Amazonビジネス」のような非現金同等物が混在していることが
 * 判明した(49期実績: 受取手形7件¥9,183,570、Amazon3件¥4,383)。これらは真の現金化(銀行口座へ
 * の資金化)が起きた時点で別途transferとして捕捉されるため、raw incomeの時点で二重にカウント
 * してはならない。
 *
 * 境界の方針(ユーザー確定、2026-09-18):
 * - bank_account型: 無条件に対象(真正の銀行口座)
 * - wallet型: デフォルト対象外。個別に現金同等物と確認できたものだけallowlistへ追加する
 *   (opt-in。将来新しいwalletable(電子マネー等)が増えても自動で巻き込まれない)
 */
export const CASH_WALLETABLE_ALLOWLIST: {
  /** wallet型のうち、現金同等物と確認済みでraw income/expenseに含めるwalletable_id */
  walletIds: number[];
} = {
  walletIds: [],
};

export function isCashWalletable(walletable: { type: string; id: number }): boolean {
  if (walletable.type === "bank_account") return true;
  if (walletable.type === "wallet") return CASH_WALLETABLE_ALLOWLIST.walletIds.includes(walletable.id);
  return false;
}
