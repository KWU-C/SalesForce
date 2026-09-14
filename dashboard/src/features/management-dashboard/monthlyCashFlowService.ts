import {
  getMonthlyCashFlowSnapshot,
  saveMonthlyCashFlowSnapshot,
} from "@/repositories/monthlyCashFlowSnapshotRepository";
import { getFreeeCompanyId } from "@/repositories/freeeAuthRepository";
import { computeMonthlyCashFlow } from "./monthlyCashFlow";
import type { MonthlyCashFlow } from "./types";

/**
 * 指定した(fiscalYear, month)の月次資金収支スナップショットを取得する。
 * - forceRefresh=trueなら常にfreeeから再取得してFirestoreを上書きする(「更新」操作用)
 * - それ以外はFirestoreのキャッシュがあればそれを返し、無ければfreeeから取得して
 *   Firestoreへ保存する(遅延バックフィル)。
 * 会計データは過去月でも修正され得るため、キャッシュを永久固定にはしない
 * (更新操作で明示的に再取得できる、ユーザー確定)。freee未接続の場合はnull。
 */
export async function getOrFetchMonthlyCashFlow(
  fiscalYear: number,
  month: number,
  options: { forceRefresh?: boolean } = {}
): Promise<MonthlyCashFlow | null> {
  if (!options.forceRefresh) {
    const cached = await getMonthlyCashFlowSnapshot(fiscalYear, month);
    if (cached) return cached;
  }

  const companyId = await getFreeeCompanyId();
  if (companyId === null) return null;

  const values = await computeMonthlyCashFlow(companyId, fiscalYear, month);
  const snapshot: MonthlyCashFlow = { fiscalYear, month, ...values, fetchedAt: new Date() };
  await saveMonthlyCashFlowSnapshot(snapshot);
  return snapshot;
}
