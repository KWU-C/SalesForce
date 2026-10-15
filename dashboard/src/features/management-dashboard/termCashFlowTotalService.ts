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
 * Firestoreにあればそれをそのまま返す。無ければfreeeから12か月分を計算してFirestoreへ保存する。
 * 通常のページアクセスはforceRefresh省略(=false)で呼ぶため、保存済みの期を勝手に再計算しない
 * (ユーザー確定、2026-09-18)。forceRefreshで呼ぶのは、「この期をfreeeから更新」ボタンと、
 * 期首から数か月間だけ前期を取り直す18時の定時Job(refreshPastCashFlows、前期の月次決算・
 * 決算整理を反映するため、ユーザー指示 2026-10-15)の2か所。
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
