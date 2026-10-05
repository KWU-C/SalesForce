import { getFundReserveSnapshot, saveFundReserveSnapshot } from "@/repositories/fundReserveSnapshotRepository";
import { FUND_RESERVE_CALCULATION_VERSION, getFundReserveCore } from "./fundReserve";
import type { FundReserveCoreSnapshot } from "./fundReserve";

/**
 * 指定した(fiscalYear, month)の資金の備え(freee由来部分、現預金は含まない)スナップショットを
 * 取得する。
 * - forceRefresh=trueなら常にfreeeから再取得してFirestoreを上書きする(「更新」操作用)
 * - それ以外はFirestoreのキャッシュがあればそれを返し、無ければfreeeから取得して
 *   Firestoreへ保存する(遅延バックフィル)。算出ロジックの版が違うキャッシュは無いものとして
 *   扱い取り直す(試算表と勘定科目の2回の呼び出しで済むため、月次資金収支のような
 *   「旧ロジック」表示にはしない)。
 * monthlyCashFlowServiceと同じ設計(過去月=Firestore/当月=freeeライブの切り替え、
 * ユーザー確定、2026-09-15)。現預金総額・設定値・借入残高に依存する値は呼び出し側で
 * composeFundReserveを使ってその場で合成すること(キャッシュしない)。freee未接続の場合はnull。
 */
export async function getOrFetchFundReserveCore(
  fiscalYear: number,
  month: number,
  options: { forceRefresh?: boolean } = {}
): Promise<FundReserveCoreSnapshot | null> {
  if (!options.forceRefresh) {
    const cached = await getFundReserveSnapshot(fiscalYear, month);
    if (cached && cached.calculationVersion === FUND_RESERVE_CALCULATION_VERSION) return cached;
  }

  const core = await getFundReserveCore(fiscalYear, month);
  if (core === null) return null;

  const snapshot: FundReserveCoreSnapshot = { fiscalYear, month, ...core, fetchedAt: new Date() };
  await saveFundReserveSnapshot(snapshot);
  return snapshot;
}
