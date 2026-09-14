import {
  getMonthlyFinanceSnapshot,
  saveMonthlyFinanceSnapshot,
} from "@/repositories/monthlyFinanceSnapshotRepository";
import { getFreeeCompanyId } from "@/repositories/freeeAuthRepository";
import {
  FISCAL_MONTH_ORDER,
  fiscalMonthIndex,
  freeeFiscalYearForTerm,
  getCurrentFiscalPeriod,
} from "@/config/fiscalPeriods";
import { fetchMonthlyFinanceFromFreee } from "./monthlyFinanceSnapshot";
import type { MonthlyFinanceSnapshot } from "./types";

/**
 * 指定した(fiscalYear, month)の月次経営スナップショットを取得する。
 * - forceRefresh=trueなら常にfreeeから再取得してFirestoreを上書きする(「更新」操作用)
 * - それ以外はFirestoreのキャッシュがあればそれを返し、無ければfreeeから取得して
 *   Firestoreへ保存する(遅延バックフィル)。
 * 会計データは過去月でも修正され得るため、キャッシュを永久固定にはしない
 * (更新操作で明示的に再取得できる、ユーザー確定、2026-09-14)。
 * freee未接続の場合はnull。
 */
export async function getOrFetchMonthlyFinance(
  fiscalYear: number,
  month: number,
  options: { forceRefresh?: boolean } = {}
): Promise<MonthlyFinanceSnapshot | null> {
  if (!options.forceRefresh) {
    const cached = await getMonthlyFinanceSnapshot(fiscalYear, month);
    if (cached) return cached;
  }

  const companyId = await getFreeeCompanyId();
  if (companyId === null) return null;

  const values = await fetchMonthlyFinanceFromFreee(companyId, fiscalYear, month);
  const snapshot: MonthlyFinanceSnapshot = { fiscalYear, month, ...values, fetchedAt: new Date() };
  await saveMonthlyFinanceSnapshot(snapshot);
  return snapshot;
}

function isFutureMonth(term: number, month: number, currentTerm: number, currentMonth: number): boolean {
  if (term > currentTerm) return true;
  if (term < currentTerm) return false;
  return fiscalMonthIndex(month) > fiscalMonthIndex(currentMonth);
}

/**
 * 指定した事業期の9月〜8月・12ヶ月分の月次推移を取得する。
 * まだ到来していない月は推測値を出さずスキップする。当月は常にforceRefreshする
 * (INPUT/OUTPUT/PROFIT/CASHセクションの当月表示と一致させるため)。
 * 過去月はキャッシュ優先のため、一度取得済みの期であれば2回目以降のアクセスは
 * ほぼFirestore読み取りのみで完結する(画面アクセスのたびにfreeeを12回呼ばない)。
 */
export async function getFiscalYearTrend(term: number): Promise<MonthlyFinanceSnapshot[]> {
  const fiscalYear = freeeFiscalYearForTerm(term);
  const { term: currentTerm, currentMonth } = getCurrentFiscalPeriod();

  const targets = FISCAL_MONTH_ORDER.filter((month) => !isFutureMonth(term, month, currentTerm, currentMonth));

  const snapshots = await Promise.all(
    targets.map((month) => {
      const isCurrent = term === currentTerm && month === currentMonth;
      return getOrFetchMonthlyFinance(fiscalYear, month, { forceRefresh: isCurrent });
    })
  );

  return snapshots.filter((s): s is MonthlyFinanceSnapshot => s !== null);
}
