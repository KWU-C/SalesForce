import { FISCAL_MONTH_ORDER, fiscalMonthIndex } from "@/config/fiscalPeriods";
import { getFinancialSummarySnapshot } from "@/repositories/financialSummarySnapshotRepository";
import type { FinancialSummarySnapshot } from "./financialSummary";

/** 当期累計営業利益推移の1点(横軸=暦月、縦軸=期首(9月)からその月までの累計営業利益) */
export interface OperatingProfitTrendPoint {
  /** 暦月(1〜12) */
  month: number;
  cumulativeOperatingProfit: number | null;
}

/**
 * 当期の「9月〜当月」累計営業利益推移。
 *
 * 新しい集計ロジックは作らず、既存のfinancialSummarySnapshots(当期累計サマリー、
 * FinancialSummaryCardsと同一の値)を月ごとに読むだけにする(ユーザー確定、2026-09-22)。
 * 各スナップショットは、その月が「当月」だった時点でfreeeから取得・保存された
 * 累計値であり、月が進んだ後は再取得されない(financialSummaryService.tsと同じ
 * キャッシュ設計)。
 *
 * - 当月より前の月は、Firestoreキャッシュに限定して読む(getFinancialSummarySnapshot、
 *   forceRefreshに相当する処理はしない)。キャッシュが無ければ「データ未設定」扱い(null)にする。
 *   もしここでキャッシュ無し時にfreeeへ素の再取得(fiscalYearのみ指定)をかけると、
 *   freee側は「本日時点までの累計」を返す仕様のため、過去月のドキュントとして誤った
 *   (今日時点の)値を保存しかねない(推測値を出さない方針に反するため、それは絶対にしない)。
 * - 当月分は、呼び出し側(ページ)がすでに取得済みのFinancialSummarySnapshotをそのまま使う。
 *   グラフ用に別途取得し直さないことで、上部カードの「営業利益」と機械的に必ず一致する
 *   (別計算ロジックを作らない、ユーザー確定)。
 */
export async function getOperatingProfitTrend(
  fiscalYear: number,
  currentMonth: number,
  currentSummary: FinancialSummarySnapshot | null
): Promise<OperatingProfitTrendPoint[]> {
  const currentIndex = fiscalMonthIndex(currentMonth); // 1〜12(9月=1)
  const priorMonths = FISCAL_MONTH_ORDER.slice(0, currentIndex - 1);

  const points: OperatingProfitTrendPoint[] = [];
  for (const month of priorMonths) {
    const snapshot = await getFinancialSummarySnapshot(fiscalYear, month);
    points.push({ month, cumulativeOperatingProfit: snapshot?.operatingProfit ?? null });
  }
  points.push({ month: currentMonth, cumulativeOperatingProfit: currentSummary?.operatingProfit ?? null });
  return points;
}
