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
  /** wallet型のうち、現金同等物と確認済みで入出金の集計に含めるwalletable_id */
  walletIds: number[];
} = {
  // 5980023=「現金」(小口現金)。試算表の「現金・預金」に含まれ、含めないと月初+入金-出金=月末が
  // 小口現金の外部入出金の分だけ合わない(49期通期で-3,536,494円。含めると全月0、
  // output/claude49-verify/EXPENSE_AUDIT.md、ユーザー確定 2026-09-19)。銀行↔現金の引出・入金は
  // 内部移動になる。受取手形・電子債権(7615514)・Amazonビジネス(7503642)は現金同等物ではないので含めない
  walletIds: [5980023],
};

export function isCashWalletable(walletable: { type: string; id: number }): boolean {
  if (walletable.type === "bank_account") return true;
  if (walletable.type === "wallet") return CASH_WALLETABLE_ALLOWLIST.walletIds.includes(walletable.id);
  return false;
}
