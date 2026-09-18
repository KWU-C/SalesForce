import {
  getFinancialSummarySnapshot,
  saveFinancialSummarySnapshot,
} from "@/repositories/financialSummarySnapshotRepository";
import { getFinancialSummary } from "./financialSummary";
import type { FinancialSummarySnapshot } from "./financialSummary";

/**
 * 当期累計の経営サマリーを取得する。
 * - forceRefresh=trueなら常にfreeeから再取得してFirestoreを上書きする(「更新」操作用)
 * - それ以外はFirestoreのキャッシュ(当月分)があればそれを返し、無ければfreeeから
 *   取得してFirestoreへ保存する(遅延バックフィル)。
 * monthlyCashFlowService/loanStatusServiceと同じ設計(ユーザー確定、2026-09-18)。
 * freee未接続の場合はnull。
 */
export async function getOrFetchFinancialSummary(
  fiscalYear: number,
  month: number,
  options: { forceRefresh?: boolean } = {}
): Promise<FinancialSummarySnapshot | null> {
  if (!options.forceRefresh) {
    const cached = await getFinancialSummarySnapshot(fiscalYear, month);
    if (cached) return cached;
  }

  const summary = await getFinancialSummary();
  if (summary === null) return null;

  const snapshot: FinancialSummarySnapshot = { fiscalYear, month, ...summary, fetchedAt: new Date() };
  await saveFinancialSummarySnapshot(snapshot);
  return snapshot;
}
