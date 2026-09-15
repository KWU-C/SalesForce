import { getLoanStatusSnapshot, saveLoanStatusSnapshot } from "@/repositories/loanStatusSnapshotRepository";
import { getLoanStatus } from "./loanStatus";
import type { LoanStatusSnapshot } from "./loanStatus";

/**
 * 指定した(fiscalYear, month)の借入状況スナップショットを取得する。
 * - forceRefresh=trueなら常にfreeeから再取得してFirestoreを上書きする(「更新」操作用)
 * - それ以外はFirestoreのキャッシュがあればそれを返し、無ければfreeeから取得して
 *   Firestoreへ保存する(遅延バックフィル)。
 * monthlyCashFlowServiceと同じ設計(過去月=Firestore/当月=freeeライブの切り替え、
 * ユーザー確定、2026-09-15)。freee未接続の場合はnull。
 */
export async function getOrFetchLoanStatus(
  fiscalYear: number,
  month: number,
  options: { forceRefresh?: boolean } = {}
): Promise<LoanStatusSnapshot | null> {
  if (!options.forceRefresh) {
    const cached = await getLoanStatusSnapshot(fiscalYear, month);
    if (cached) return cached;
  }

  const loanStatus = await getLoanStatus(fiscalYear, month);
  if (loanStatus === null) return null;

  const snapshot: LoanStatusSnapshot = { fiscalYear, month, ...loanStatus, fetchedAt: new Date() };
  await saveLoanStatusSnapshot(snapshot);
  return snapshot;
}
