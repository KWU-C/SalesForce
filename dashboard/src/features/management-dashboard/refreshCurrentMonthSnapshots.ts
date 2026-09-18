import { getOrFetchMonthlyCashFlow } from "./monthlyCashFlowService";
import { getOrFetchLoanStatus } from "./loanStatusService";
import { getOrFetchFundReserveCore } from "./fundReserveService";
import { getOrFetchFinancialSummary } from "./financialSummaryService";

export interface RefreshSnapshotsResult {
  /** false の場合、いずれかのスナップショットがfreee未接続(null)だったことを示す。
   * 個々のfreee API呼び出し自体の失敗(freee_api_error等)は呼び出し元へthrowする
   * (ここでは飲み込まない) */
  connected: boolean;
}

/**
 * 指定(fiscalYear, month)分の月次資金収支・借入状況・資金の備えをfreeeから強制的に
 * 再取得しFirestoreへ保存する。includeFinancialSummary=trueなら当期累計サマリーも
 * 併せて更新する(当期累計は「当月」に紐付く値のため、past月の個別更新では
 * 求めない、ユーザー確定、2026-09-18)。
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
  const [cashFlow, loanStatus, fundReserveCore, financialSummary] = await Promise.all([
    getOrFetchMonthlyCashFlow(fiscalYear, month, { forceRefresh: true }),
    getOrFetchLoanStatus(fiscalYear, month, { forceRefresh: true }),
    getOrFetchFundReserveCore(fiscalYear, month, { forceRefresh: true }),
    options.includeFinancialSummary
      ? getOrFetchFinancialSummary(fiscalYear, month, { forceRefresh: true })
      : Promise.resolve(undefined),
  ]);

  const connected =
    cashFlow !== null &&
    loanStatus !== null &&
    fundReserveCore !== null &&
    (!options.includeFinancialSummary || financialSummary !== null);

  return { connected };
}
