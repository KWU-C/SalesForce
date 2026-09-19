/**
 * 入出金(キャッシュイン・キャッシュアウト)の計算ロジックのバージョン。分類ルール・境界定義・
 * 集計方法を変えたら必ずインクリメントする。保存済みスナップショット(monthlyCashFlowSnapshots・
 * termCashFlowSnapshots)のこの値が現在のバージョンと異なる場合は「旧ロジック」として表示し、
 * 次回の更新(定時Job/「更新」ボタン/「この期をfreeeから更新」)で再計算させる。仕訳帳のエクスポートが
 * 非同期で重いため、ページ表示時の自動再計算はしない(ユーザー確定、2026-09-19)。
 *
 * v3(2026-09-19): 入金・出金とも、銀行明細＋公式振替＋override(v2)ではなく、仕訳帳の相手科目による
 * 区分(journalCashFlow.ts)に変更。現金walletを集計境界に追加。営業キャッシュ収支は営業入金を起点に再定義。
 */
export const EXTERNAL_CASH_FLOW_CALCULATION_VERSION = "external-cashflow-v3-2026-09-19";

/**
 * "provisional": 49期固有の証拠付き補完・除外(帳簿補完、ネットゼロ往復)を適用した、または未分類が
 * 残る期間(49期のようなfreee移行期はほぼ常にこれになる)。
 * "final": 恒久ロジックだけで機械的に確定でき、未分類も無い期間(50期以降を想定)。
 */
export type ExternalCashFlowStatus = "provisional" | "final";
