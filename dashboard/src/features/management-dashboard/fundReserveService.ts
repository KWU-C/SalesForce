import { getFundReserveSnapshot, saveFundReserveSnapshot } from "@/repositories/fundReserveSnapshotRepository";
import { getFundReserveCore } from "./fundReserve";
import type { FundReserveCoreSnapshot } from "./fundReserve";

/**
 * 指定した(fiscalYear, month)の資金の備え(freee由来部分、現預金は含まない)スナップショットを
 * 取得する。
 * - forceRefresh=trueなら常にfreeeから再取得してFirestoreを上書きする(「更新」操作用)
 * - それ以外はFirestoreのキャッシュがあればそれを返し、無ければfreeeから取得して
 *   Firestoreへ保存する(遅延バックフィル)。
 * monthlyCashFlowServiceと同じ設計(過去月=Firestore/当月=freeeライブの切り替え、
 * ユーザー確定、2026-09-15)。現預金(cash)とfreeCashは呼び出し側でcomposeFundReserveを
 * 使ってその場で合成すること(キャッシュしない)。freee未接続の場合はnull。
 */
export async function getOrFetchFundReserveCore(
  fiscalYear: number,
  month: number,
  options: { forceRefresh?: boolean } = {}
): Promise<FundReserveCoreSnapshot | null> {
  if (!options.forceRefresh) {
    const cached = await getFundReserveSnapshot(fiscalYear, month);
    if (cached) return cached;
  }

  const core = await getFundReserveCore(fiscalYear, month);
  if (core === null) return null;

  const snapshot: FundReserveCoreSnapshot = { fiscalYear, month, ...core, fetchedAt: new Date() };
  await saveFundReserveSnapshot(snapshot);
  return snapshot;
}
