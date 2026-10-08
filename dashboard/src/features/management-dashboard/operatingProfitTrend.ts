import { FISCAL_MONTH_ORDER, fiscalMonthIndex } from "@/config/fiscalPeriods";
import { getFinancialSummarySnapshot } from "@/repositories/financialSummarySnapshotRepository";
import type { FinancialSummarySnapshot } from "./financialSummary";

/**
 * 事業収支(売上高→粗利益→営業利益)推移の1点(横軸=暦月、縦軸=期首(9月)からその月までの累計)。
 * 経常利益は営業外損益が入り事業収支の構造が分かりにくくなるため含めない(ユーザー確定、2026-10-08)。
 */
export interface OperatingProfitTrendPoint {
  /** 暦月(1〜12) */
  month: number;
  cumulativeRevenue: number | null;
  cumulativeGrossProfit: number | null;
  cumulativeOperatingProfit: number | null;
}

// 3系列とも同じスナップショット1件から読む(系列ごとに別の取得元・別計算にしない)。
// 古いドキュメント等でフィールド自体が無い場合もnull(データ未設定)として扱う
function toPoint(month: number, summary: FinancialSummarySnapshot | null): OperatingProfitTrendPoint {
  return {
    month,
    cumulativeRevenue: summary?.revenue ?? null,
    cumulativeGrossProfit: summary?.grossProfit ?? null,
    cumulativeOperatingProfit: summary?.operatingProfit ?? null,
  };
}

/**
 * 当期の「9月〜当月」累計の売上高・粗利益・営業利益の推移。
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
 *   グラフ用に別途取得し直さないことで、上部カードの「売上高」「粗利益」「営業利益」と機械的に必ず一致する
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
    points.push(toPoint(month, snapshot));
  }
  points.push(toPoint(currentMonth, currentSummary));
  return points;
}
