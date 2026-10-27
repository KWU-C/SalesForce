import { FISCAL_MONTH_ORDER } from "@/config/fiscalPeriods";
import { getFreeeCompanyId } from "@/repositories/freeeAuthRepository";
import {
  getMonthlyPerformanceSnapshot,
  saveMonthlyPerformanceSnapshot,
} from "@/repositories/monthlyPerformanceSnapshotRepository";
import { MONTHLY_PERFORMANCE_CALCULATION_VERSION, fetchMonthlyPerformance } from "./monthlyPerformance";
import type { MonthlyPerformanceSnapshot } from "./monthlyPerformance";
import { termMonthsThrough } from "./monthlyPlService";

/**
 * 期首(9月)から指定月までの月次業績・採算を、すべてfreeeから取り直してFirestoreへ上書き保存する。
 * 過去月も後日仕訳(仕掛品振替・賞与引当など)が入るため、過去月を固定しない(monthlyPlServiceと同じ方針)。
 * freee APIは1か月4回で、レート制限に配慮して1件ずつ順に呼ぶ。途中で1件でも失敗したらthrowし、
 * 何も保存しない(一部の月だけ新しい状態にしない)。freee未接続の場合はnull。
 */
export async function refreshTermPerformance(
  fiscalYear: number,
  throughMonth: number
): Promise<MonthlyPerformanceSnapshot[] | null> {
  const companyId = await getFreeeCompanyId();
  if (companyId === null) return null;

  const snapshots: MonthlyPerformanceSnapshot[] = [];
  for (const month of termMonthsThrough(throughMonth)) {
    const performance = await fetchMonthlyPerformance(companyId, fiscalYear, month);
    snapshots.push({
      fiscalYear,
      month,
      ...performance,
      fetchedAt: new Date(),
      calculationVersion: MONTHLY_PERFORMANCE_CALCULATION_VERSION,
    });
  }
  await Promise.all(snapshots.map((snapshot) => saveMonthlyPerformanceSnapshot(snapshot)));
  return snapshots;
}

/**
 * 期首(9月)から指定月までの月次業績・採算を返す(並びは期首月から。未取得の月はnull)。
 * - forceRefresh=trueなら常に全月をfreeeから再取得する(定時更新・手動更新用)
 * - それ以外はFirestoreだけを読む。ただし1か月でも保存が無い場合(月替わり直後・導入直後・前期の初回)は
 *   全月をfreeeから取得する(遅延バックフィル)
 * 算出バージョンが現行と異なる保存済みドキュメントは未取得として扱う。freee未接続の場合はnull。
 */
export async function getOrFetchTermPerformance(
  fiscalYear: number,
  throughMonth: number,
  options: { forceRefresh?: boolean } = {}
): Promise<(MonthlyPerformanceSnapshot | null)[] | null> {
  if (!options.forceRefresh) {
    const cached = await Promise.all(
      termMonthsThrough(throughMonth).map(async (month) => {
        const snapshot = await getMonthlyPerformanceSnapshot(fiscalYear, month);
        return snapshot?.calculationVersion === MONTHLY_PERFORMANCE_CALCULATION_VERSION ? snapshot : null;
      })
    );
    if (cached.every((snapshot) => snapshot !== null)) return cached;
  }
  return refreshTermPerformance(fiscalYear, throughMonth);
}

/** 前期は期末月(8月)まで12か月すべて */
export const FULL_TERM_LAST_MONTH = FISCAL_MONTH_ORDER[FISCAL_MONTH_ORDER.length - 1];
