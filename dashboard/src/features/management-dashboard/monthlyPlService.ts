import { FISCAL_MONTH_ORDER, fiscalMonthIndex } from "@/config/fiscalPeriods";
import { getFreeeCompanyId } from "@/repositories/freeeAuthRepository";
import { getMonthlyPlSnapshot, saveMonthlyPlSnapshot } from "@/repositories/monthlyPlSnapshotRepository";
import { MONTHLY_PL_CALCULATION_VERSION, fetchMonthlyPl } from "./monthlyPl";
import type { MonthlyPlSnapshot } from "./monthlyPl";

/** 期首(9月)から指定月までの暦月の並び。例: 1月 → [9, 10, 11, 12, 1] */
export function termMonthsThrough(currentMonth: number): number[] {
  return FISCAL_MONTH_ORDER.slice(0, fiscalMonthIndex(currentMonth));
}

/**
 * 当期の期首(9月)から当月までの月次P/Lを、すべてfreeeから取り直してFirestoreへ上書き保存する。
 * 過去月も後日仕訳が追加・修正されるため、過去月を固定せず毎回全月を再取得する
 * (ユーザー確定、2026-10-08。月末時点の累計スナップショットの差分で単月値を作る方式は、
 * 月をまたいで登録された仕訳が翌月に計上されてしまうため採用しない)。
 *
 * freee APIは月数ぶん(最大12回)呼ぶ。レート制限に配慮して並列にはせず1件ずつ順に取得する
 * (実測で1回0.5秒前後、12か月で約7秒。Cloud Run Jobのtask-timeout=540sに対して十分短い)。
 * 途中で1件でも取得に失敗したらthrowし、何も保存しない(一部の月だけ新しい状態にしない)。
 * freee未接続の場合はnull。
 */
export async function refreshTermMonthlyPl(
  fiscalYear: number,
  currentMonth: number
): Promise<MonthlyPlSnapshot[] | null> {
  const companyId = await getFreeeCompanyId();
  if (companyId === null) return null;

  const snapshots: MonthlyPlSnapshot[] = [];
  for (const month of termMonthsThrough(currentMonth)) {
    const pl = await fetchMonthlyPl(companyId, fiscalYear, month);
    snapshots.push({
      fiscalYear,
      month,
      ...pl,
      fetchedAt: new Date(),
      calculationVersion: MONTHLY_PL_CALCULATION_VERSION,
    });
  }
  await Promise.all(snapshots.map((snapshot) => saveMonthlyPlSnapshot(snapshot)));
  return snapshots;
}

/**
 * 当期の期首(9月)から当月までの月次P/Lを返す(並びは期首月から。未取得の月はnull)。
 * - forceRefresh=trueなら常に全月をfreeeから再取得する(定時更新・手動更新用)
 * - それ以外はFirestoreだけを読む。ただし当月分がまだ無い場合(月替わり直後や導入直後)は、
 *   他のスナップショットと同じ遅延バックフィルとして全月を取得する
 * 算出バージョンが現行と異なる保存済みドキュメントは未取得として扱う。freee未接続の場合はnull。
 */
export async function getOrFetchTermMonthlyPl(
  fiscalYear: number,
  currentMonth: number,
  options: { forceRefresh?: boolean } = {}
): Promise<(MonthlyPlSnapshot | null)[] | null> {
  if (!options.forceRefresh) {
    const cached = await Promise.all(
      termMonthsThrough(currentMonth).map(async (month) => {
        const snapshot = await getMonthlyPlSnapshot(fiscalYear, month);
        return snapshot?.calculationVersion === MONTHLY_PL_CALCULATION_VERSION ? snapshot : null;
      })
    );
    if (cached[cached.length - 1] !== null) return cached;
  }
  return refreshTermMonthlyPl(fiscalYear, currentMonth);
}
