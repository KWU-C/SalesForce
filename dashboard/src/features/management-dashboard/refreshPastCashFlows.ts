import { FISCAL_MONTH_ORDER, fiscalMonthIndex, freeeFiscalYearForTerm } from "@/config/fiscalPeriods";
import { getFreeeCompanyId } from "@/repositories/freeeAuthRepository";
import { saveMonthlyCashFlowSnapshot } from "@/repositories/monthlyCashFlowSnapshotRepository";
import { getJournalsCsv } from "@/services/freee/freeeJournalsClient";
import { journalExportRange, parseJournalCsv } from "./journalCsv";
import { computeMonthlyCashFlow } from "./monthlyCashFlow";
import { getOrComputeTermCashFlowTotal } from "./termCashFlowTotalService";

/**
 * 期首から何か月目までの間、前期(12か月分の月次と通期合計)も定時更新で取り直すか。
 * 前期末(8月)の月次決算・決算整理は翌期の9〜11月に入るため(法人税の申告期限は期末から2か月、
 * 延長あり)。この期間を過ぎた前期は、従来どおり「この期をfreeeから更新」ボタンでのみ再計算する。
 */
export const PREVIOUS_TERM_REFRESH_WINDOW_MONTHS = 3;

export interface RefreshPastCashFlowsResult {
  /** false の場合、freee未接続で何も更新していない */
  connected: boolean;
  /** 取り直した当期の過去月(暦月、期首から順) */
  refreshedMonths: number[];
  /** 前期を取り直した場合はその事業期番号 */
  refreshedPreviousTerm: number | null;
}

/**
 * 定時更新(Cloud Run Job)用。当月より前の月次資金収支を取り直してFirestoreを上書きする
 * (ユーザー指示、2026-10-15: 月次決算などで過去月の仕訳が変わっても定時更新で反映させる)。
 * それまでは過去月はキャッシュ優先で、手動の「更新」ボタンを押さない限り古いままだった
 * (例: 9月末残高が9/30取得のまま、10月初残高と59,770円ずれていた)。
 *
 * - 当期の期首〜前月: 仕訳帳のエクスポート(非同期で重い)を1回だけ行い、各月で共有する
 *   (termCashFlowTotal.tsと同じ方式)。全月の計算が終わってから保存するため、途中で失敗しても
 *   一部の月だけ新しくなることはない
 * - 期首からPREVIOUS_TERM_REFRESH_WINDOW_MONTHSか月の間は、前期も12か月+通期合計を同じ計算結果から
 *   取り直す(getOrComputeTermCashFlowTotal。月次と通期が食い違わないよう、前期の月だけを個別に更新しない)
 * 当月分はrefreshCurrentMonthSnapshotsが別に更新するため、ここでは扱わない。
 */
export async function refreshPastCashFlows(term: number, currentMonth: number): Promise<RefreshPastCashFlowsResult> {
  const companyId = await getFreeeCompanyId();
  if (companyId === null) return { connected: false, refreshedMonths: [], refreshedPreviousTerm: null };

  const fiscalYear = freeeFiscalYearForTerm(term);
  const currentIndex = fiscalMonthIndex(currentMonth);
  const pastMonths = FISCAL_MONTH_ORDER.slice(0, currentIndex - 1);

  if (pastMonths.length > 0) {
    const range = journalExportRange(fiscalYear);
    const journalGroups = parseJournalCsv(await getJournalsCsv(companyId, range.start, range.end));
    // freeeのレート制限(429)を避けるため月は逐次で計算する(termCashFlowTotal.ts参照)
    const results = [];
    for (const month of pastMonths) {
      results.push({ month, values: await computeMonthlyCashFlow(companyId, fiscalYear, month, { journalGroups }) });
    }
    const fetchedAt = new Date();
    for (const { month, values } of results) {
      await saveMonthlyCashFlowSnapshot({ fiscalYear, month, ...values, fetchedAt });
    }
  }

  let refreshedPreviousTerm: number | null = null;
  if (currentIndex <= PREVIOUS_TERM_REFRESH_WINDOW_MONTHS) {
    const total = await getOrComputeTermCashFlowTotal(term - 1, { forceRefresh: true });
    if (total) refreshedPreviousTerm = term - 1;
  }

  return { connected: true, refreshedMonths: pastMonths, refreshedPreviousTerm };
}
