import { FISCAL_MONTH_ORDER } from "@/config/fiscalPeriods";
import { getFreeeCompanyId } from "@/repositories/freeeAuthRepository";
import {
  getMonthlyPerformanceSnapshot,
  saveMonthlyPerformanceSnapshot,
} from "@/repositories/monthlyPerformanceSnapshotRepository";
import { MONTHLY_PERFORMANCE_CALCULATION_VERSION, fetchMonthlyPerformance } from "./monthlyPerformance";
import type { MonthlyPerformanceSnapshot } from "./monthlyPerformance";
import { termMonthsThrough } from "./monthlyPlService";
import { monthEndBoundary } from "./accountingReports";

/** 前期は期末月(8月)まで12か月すべて */
export const FULL_TERM_LAST_MONTH = FISCAL_MONTH_ORDER[FISCAL_MONTH_ORDER.length - 1];

/**
 * 指定した月だけをfreeeから取得してFirestoreへ上書き保存する。freee APIは1か月4回で、レート制限に
 * 配慮して1件ずつ順に呼ぶ。途中で1件でも失敗したらthrowし、何も保存しない(一部の月だけ新しい状態にしない)。
 * freee未接続の場合はnull。
 */
async function fetchAndSaveMonths(fiscalYear: number, months: number[]): Promise<MonthlyPerformanceSnapshot[] | null> {
  const companyId = await getFreeeCompanyId();
  if (companyId === null) return null;

  const snapshots: MonthlyPerformanceSnapshot[] = [];
  for (const month of months) {
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
 * 期首(9月)から指定月までの月次業績・採算を、すべてfreeeから取り直して保存する(当期の定時更新・手動更新用)。
 * 当期の過去月は後日仕訳(仕掛品振替・賞与引当など)が入るため固定しない(monthlyPlServiceと同じ方針)。
 */
export async function refreshTermPerformance(
  fiscalYear: number,
  throughMonth: number
): Promise<MonthlyPerformanceSnapshot[] | null> {
  return fetchAndSaveMonths(fiscalYear, termMonthsThrough(throughMonth));
}

/**
 * Firestoreに保存済みの月次業績・採算だけを返す(freeeは呼ばない)。並びは期首月から、未保存・算出バージョンが
 * 現行と異なる月はnull。前期の表示に使う(ユーザー確定、2026-10-27: 画面表示のたびに前期をfreeeから取得しない)。
 */
export async function getStoredTermPerformance(
  fiscalYear: number,
  throughMonth: number
): Promise<(MonthlyPerformanceSnapshot | null)[]> {
  return Promise.all(
    termMonthsThrough(throughMonth).map(async (month) => {
      const snapshot = await getMonthlyPerformanceSnapshot(fiscalYear, month);
      return snapshot?.calculationVersion === MONTHLY_PERFORMANCE_CALCULATION_VERSION ? snapshot : null;
    })
  );
}

/**
 * 期首(9月)から指定月までの月次業績・採算を返す。保存済みの月はFirestoreの値をそのまま使い、
 * 未保存(または算出バージョンが古い)月だけをfreeeから取得して保存する。
 * - 当期の画面表示: 通常は全月保存済みでfreeeを呼ばない。月替わり直後は新しい月(1か月=4回)だけ取得する
 * - 前期(確定済み): 定時更新・手動更新で、未保存の月がある時だけ取得する。保存済みの月は取り直さない
 *   (49期は決算書とfreeeが一致することを確認済み、ユーザー確定 2026-10-27)
 * freee未接続で未保存の月がある場合はnull。
 */
export async function getOrFetchTermPerformance(
  fiscalYear: number,
  throughMonth: number
): Promise<(MonthlyPerformanceSnapshot | null)[] | null> {
  const months = termMonthsThrough(throughMonth);
  const stored = await getStoredTermPerformance(fiscalYear, throughMonth);
  const missing = months.filter((_, i) => stored[i] === null);
  if (missing.length === 0) return stored;

  const fetched = await fetchAndSaveMonths(fiscalYear, missing);
  if (fetched === null) return null;
  return months.map((month, i) => stored[i] ?? fetched.find((s) => s.month === month) ?? null);
}

/** fiscal_year・暦月の月末境界(翌月1日0時JST) */
function monthEndBoundaryOf(fiscalYear: number, month: number): Date {
  const calendarYear = month >= 9 ? fiscalYear : fiscalYear + 1;
  return monthEndBoundary(`${calendarYear}-${String(month).padStart(2, "0")}`);
}

/**
 * 前期(終わった期)の12か月を返す。未保存の月と、月末前に取得した月(実際には期末の8月。8月31日の定時更新で
 * 当期として取得したもの)だけをfreeeから取り直し、月末後に保存済みの月は取り直さない(2026-11-13)。
 * 月末前の取得分を残すと、9月に概要の「前月末までの実績」(前期8月まで)がいつまでも未取得になるため。
 * 定時更新・手動更新からだけ呼ぶ(画面表示では呼ばない)。
 */
export async function getOrFetchClosedTermPerformance(
  fiscalYear: number,
  now: Date = new Date()
): Promise<(MonthlyPerformanceSnapshot | null)[] | null> {
  const months = termMonthsThrough(FULL_TERM_LAST_MONTH);
  const stored = await getStoredTermPerformance(fiscalYear, FULL_TERM_LAST_MONTH);
  const needsFetch = (month: number, snapshot: MonthlyPerformanceSnapshot | null) => {
    const boundary = monthEndBoundaryOf(fiscalYear, month);
    if (now.getTime() < boundary.getTime()) return snapshot === null; // 月末前の月は従来どおり未保存の時だけ
    return snapshot === null || snapshot.fetchedAt.getTime() < boundary.getTime();
  };
  const targets = months.filter((month, i) => needsFetch(month, stored[i]));
  if (targets.length === 0) return stored;

  const fetched = await fetchAndSaveMonths(fiscalYear, targets);
  if (fetched === null) return null;
  return months.map((month, i) => fetched.find((s) => s.month === month) ?? stored[i]);
}
