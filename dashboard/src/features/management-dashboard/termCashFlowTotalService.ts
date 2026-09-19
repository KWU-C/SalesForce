import {
  getTermCashFlowSnapshot,
  saveTermCashFlowSnapshot,
} from "@/repositories/termCashFlowSnapshotRepository";
import { getFreeeCompanyId } from "@/repositories/freeeAuthRepository";
import { saveMonthlyCashFlowSnapshot } from "@/repositories/monthlyCashFlowSnapshotRepository";
import { computeTermCashFlow } from "./termCashFlowTotal";
import type { TermCashFlowTotal } from "./termCashFlowTotal";

/**
 * 指定した事業期の通期資金収支合計を取得する。
 * Firestoreにあればそれをそのまま返す(以後不変、再計算はしない)。無ければfreeeから
 * 12か月分を計算してFirestoreへ保存する（初回のみ）。通常のページアクセス・18時の
 * 定時Jobは常にforceRefresh省略(=false)で呼ぶため、一度保存された期を勝手に
 * 再計算することは無い(ユーザー確定、2026-09-18)。forceRefreshは、終わった期の値を
 * 手動で直したい場合の「更新」ボタン用にのみ用意する(ユーザー確定、2026-09-18)。
 * freee未接続の場合はnull。
 *
 * 計算した12か月分の月次結果も、月次スナップショットとして同時に保存する(入金側v3、2026-09-19)。
 * 通期は12か月の単純合計であり、同じ計算結果から月次と通期の両方を保存することで、
 * 表示上の月次と通期が必ず一致する(別々に計算して食い違うことがない)。
 */
export async function getOrComputeTermCashFlowTotal(
  term: number,
  options: { forceRefresh?: boolean } = {}
): Promise<TermCashFlowTotal | null> {
  if (!options.forceRefresh) {
    const cached = await getTermCashFlowSnapshot(term);
    if (cached) return cached;
  }

  const companyId = await getFreeeCompanyId();
  if (companyId === null) return null;

  const { total, months } = await computeTermCashFlow(companyId, term);
  const now = new Date();
  for (const { month, values } of months) {
    await saveMonthlyCashFlowSnapshot({ fiscalYear: total.fiscalYear, month, ...values, fetchedAt: now });
  }
  const snapshot: TermCashFlowTotal = { ...total, computedAt: now };
  await saveTermCashFlowSnapshot(snapshot);
  return snapshot;
}
