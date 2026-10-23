import {
  getFinancialSummarySnapshot,
  saveFinancialSummarySnapshot,
} from "@/repositories/financialSummarySnapshotRepository";
import { FINANCIAL_SUMMARY_CALCULATION_VERSION, getFinancialSummary } from "./financialSummary";
import type { FinancialSummarySnapshot } from "./financialSummary";

/**
 * 当期累計(期首〜monthの月末)の経営サマリーを取得する。
 * - forceRefresh=trueなら常にfreeeから再取得してFirestoreを上書きする(「更新」操作用)
 * - それ以外はFirestoreのキャッシュ(当月分)があればそれを返し、無ければfreeeから
 *   取得してFirestoreへ保存する(遅延バックフィル)。
 * monthlyCashFlowService/loanStatusServiceと同じ設計(ユーザー確定、2026-09-18)。
 * 算出バージョンが現在と違う保存分は「未取得」として扱い、取り直して上書きする(その月の1件だけ)。
 * freee未接続の場合はnull。
 */
export async function getOrFetchFinancialSummary(
  fiscalYear: number,
  month: number,
  options: { forceRefresh?: boolean } = {}
): Promise<FinancialSummarySnapshot | null> {
  if (!options.forceRefresh) {
    const cached = await getFinancialSummarySnapshot(fiscalYear, month);
    if (cached && cached.calculationVersion === FINANCIAL_SUMMARY_CALCULATION_VERSION) return cached;
  }

  const summary = await getFinancialSummary(fiscalYear, month);
  if (summary === null) return null;

  const snapshot: FinancialSummarySnapshot = {
    fiscalYear,
    month,
    ...summary,
    fetchedAt: new Date(),
    calculationVersion: FINANCIAL_SUMMARY_CALCULATION_VERSION,
  };
  await saveFinancialSummarySnapshot(snapshot);
  return snapshot;
}
