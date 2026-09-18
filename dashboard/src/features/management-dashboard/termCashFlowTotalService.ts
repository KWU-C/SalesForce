import {
  getTermCashFlowSnapshot,
  saveTermCashFlowSnapshot,
} from "@/repositories/termCashFlowSnapshotRepository";
import { getFreeeCompanyId } from "@/repositories/freeeAuthRepository";
import { computeTermCashFlowTotal } from "./termCashFlowTotal";
import type { TermCashFlowTotal } from "./termCashFlowTotal";

/**
 * 指定した事業期の通期資金収支合計を取得する。
 * Firestoreにあればそれをそのまま返す(以後不変、再計算しない)。無ければfreeeから
 * 12か月分を計算してFirestoreへ保存する（初回のみ）。forceRefreshオプションは
 * 意図的に持たせていない(終わった期の値は変わらない前提のため、ユーザー確定、
 * 2026-09-18)。通常のページアクセス・18時の定時Jobのいずれからも、この関数が
 * 一度保存された期を再計算することは無い。freee未接続の場合はnull。
 */
export async function getOrComputeTermCashFlowTotal(term: number): Promise<TermCashFlowTotal | null> {
  const cached = await getTermCashFlowSnapshot(term);
  if (cached) return cached;

  const companyId = await getFreeeCompanyId();
  if (companyId === null) return null;

  const values = await computeTermCashFlowTotal(companyId, term);
  const snapshot: TermCashFlowTotal = { ...values, computedAt: new Date() };
  await saveTermCashFlowSnapshot(snapshot);
  return snapshot;
}
