import { getOrFetchMonthlyCashFlow } from "./monthlyCashFlowService";
import { getOrFetchLoanStatus } from "./loanStatusService";
import { getOrFetchFundReserveCore } from "./fundReserveService";
import { getOrFetchFinancialSummary } from "./financialSummaryService";
import { getOrFetchTermMonthlyPl } from "./monthlyPlService";
import { reconcileMonthlyPlWithSummary } from "./monthlyPl";
import type { MonthlyPlReconciliation } from "./monthlyPl";

export interface RefreshSnapshotsResult {
  /** false の場合、いずれかのスナップショットがfreee未接続(null)だったことを示す。
   * 個々のfreee API呼び出し自体の失敗(freee_api_error等)は呼び出し元へthrowする
   * (ここでは飲み込まない) */
  connected: boolean;
  /** includeFinancialSummary=trueの時だけ入る。月次P/L合計と当期累計サマリーの検算結果 */
  monthlyPlReconciliation?: MonthlyPlReconciliation;
}

/**
 * 指定(fiscalYear, month)分の月次資金収支・借入状況・資金の備えをfreeeから強制的に
 * 再取得しFirestoreへ保存する。includeFinancialSummary=trueなら当期累計サマリーも
 * 併せて更新する(当期累計は「当月」に紐付く値のため、past月の個別更新では
 * 求めない、ユーザー確定、2026-09-18)。
 *
 * includeFinancialSummary=trueの時は、事業収支の推移グラフ用の月次P/L(期首の9月〜当月の
 * 全月)も取り直す。過去月も後日仕訳が追加・修正されるため固定しない(ユーザー確定、2026-10-08)。
 * 取得後、月次P/L合計が当期累計サマリー(上部カード)の売上高・営業利益と一致するか検算し、
 * 一致しなければ差を警告ログに出す(数値は補正しない)。
 *
 * Web手動更新ルート(`/api/freee/monthly-finance/refresh`)とCloud Run Job
 * (`src/jobs/scheduledFinanceRefresh.ts`)の両方から同じ実装を使う共通ヘルパー
 * (重複実装を避けるため切り出し、ユーザー確定、2026-09-18)。Next.js/IAPには
 * 一切依存しない(services/repositoriesのみに依存する純粋な関数)。
 */
export async function refreshCurrentMonthSnapshots(
  fiscalYear: number,
  month: number,
  options: { includeFinancialSummary?: boolean } = {}
): Promise<RefreshSnapshotsResult> {
  const [cashFlow, loanStatus, fundReserveCore, financialSummary, monthlyPl] = await Promise.all([
    getOrFetchMonthlyCashFlow(fiscalYear, month, { forceRefresh: true }),
    getOrFetchLoanStatus(fiscalYear, month, { forceRefresh: true }),
    getOrFetchFundReserveCore(fiscalYear, month, { forceRefresh: true }),
    options.includeFinancialSummary
      ? getOrFetchFinancialSummary(fiscalYear, month, { forceRefresh: true })
      : Promise.resolve(undefined),
    options.includeFinancialSummary
      ? getOrFetchTermMonthlyPl(fiscalYear, month, { forceRefresh: true })
      : Promise.resolve(undefined),
  ]);

  const connected =
    cashFlow !== null &&
    loanStatus !== null &&
    fundReserveCore !== null &&
    (!options.includeFinancialSummary || (financialSummary !== null && monthlyPl !== null));

  if (!financialSummary || !monthlyPl) return { connected };

  // forceRefresh時は全月が取得済み(null要素なし)。型の上でだけnullを除く
  const monthlyPlReconciliation = reconcileMonthlyPlWithSummary(
    monthlyPl.filter((m) => m !== null),
    financialSummary
  );
  if (!monthlyPlReconciliation.matches) {
    // 原因確認用に差(月次合計 − 当期累計)だけを出す。累計や月次の金額そのものは出さない
    console.warn(
      `[refreshCurrentMonthSnapshots] 月次P/L合計が当期累計サマリーと一致しません` +
        `(売上高の差=${monthlyPlReconciliation.revenueDiff}, 営業利益の差=${monthlyPlReconciliation.operatingProfitDiff})`
    );
  }
  return { connected, monthlyPlReconciliation };
}
