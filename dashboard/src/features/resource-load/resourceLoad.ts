import type { ConcreteCrId } from "@/domain/types";

/**
 * 推定負荷率（/resource専用、営業進捗の既存指標「受注」「完了」「達成率」「累計」とは
 * 完全に独立した参考指標。既存ロジックには一切影響しない、ユーザー確定2026-09-18）。
 *
 * 手法（ユーザー確定、2026-09-18。3方式を試算した末の最終版）:
 * 「受注月(juchuubi__c)〜完了月(seikyuubi__c)まで、案件粗利(arari__c)を均等配分する」。
 * 過去に消化済みの月へも配分はするが、現在月より前の配分分は現在以降の負荷には
 * 再集計しない（過去の負荷を現在に押し込まない）。CR1〜4で配賦ロジックは共通
 * （CR別の個別荷重係数は設けない）。
 */

/** 1人日あたりの標準粗利単価(円)。仮説値、ユーザー確定2026-09-18(旧80,000円から変更) */
export const STANDARD_GROSS_PROFIT_PER_PERSON_DAY = 100000;
/** 1人あたりの月間供給可能人日。仮説値 */
export const AVAILABLE_PERSON_DAYS_PER_MONTH = 16;

export interface ResourceLoadDeal {
  crId: ConcreteCrId;
  /** 案件粗利(arari__c)。null(空欄)は0として扱う */
  grossProfit: number | null;
  /** 受注日(juchuubi__c)、yyyy-mm-dd */
  orderDate: string;
  /** 完了月の判定日(seikyuubi__c、請求日)、yyyy-mm-dd。既存「完了」定義と同じ */
  completionDate: string;
}

export interface CrResourceLoad {
  crId: ConcreteCrId;
  headcount: number;
  /** 現在月に配賦された受注済み案件粗利の合計(円) */
  referenceGrossProfit1m: number;
  /** 現在月+翌月+翌々月に配賦された受注済み案件粗利の合計(円) */
  referenceGrossProfit3m: number;
  requiredPersonDays1m: number;
  requiredPersonDays3m: number;
  availablePersonDays1m: number;
  availablePersonDays3m: number;
  /** % */
  loadRate1m: number;
  /** % */
  loadRate3m: number;
}

export interface ResourceLoadResult {
  crLoads: CrResourceLoad[];
  /** 受注月>完了月など、配賦不能で計算から除外した案件数 */
  anomalyCount: number;
}

function monthIndex(dateStr: string): number {
  const [y, m] = dateStr.split("-").map(Number);
  return y * 12 + (m - 1);
}

/**
 * 受注済み案件を受注月〜完了月まで均等配分し、CRごとの推定負荷率を算出する。
 * currentYear/currentMonthは呼び出し側(page.tsx)がgetCurrentFiscalPeriod等から渡す
 * (このモジュール自体は現在時刻に依存しない純粋関数にする)。
 */
export function computeResourceLoad(
  deals: readonly ResourceLoadDeal[],
  crIds: readonly ConcreteCrId[],
  currentYear: number,
  currentMonth: number,
  headcountByCr: Readonly<Record<ConcreteCrId, number>>
): ResourceLoadResult {
  const currentIdx = monthIndex(`${currentYear}-${String(currentMonth).padStart(2, "0")}`);
  const targetMonths = [currentIdx, currentIdx + 1, currentIdx + 2];

  const monthlyByCr = new Map<ConcreteCrId, Map<number, number>>(crIds.map((crId) => [crId, new Map()]));
  let anomalyCount = 0;

  for (const deal of deals) {
    const startIdx = monthIndex(deal.orderDate);
    const endIdx = monthIndex(deal.completionDate);
    const span = endIdx - startIdx + 1;
    if (span < 1) {
      anomalyCount += 1;
      continue;
    }
    const grossProfit = deal.grossProfit ?? 0;
    const perMonth = grossProfit / span;
    const monthly = monthlyByCr.get(deal.crId);
    if (!monthly) continue; // 対象外CR(事業期にまだ存在しないCR等)は無視

    for (let idx = startIdx; idx <= endIdx; idx++) {
      if (idx < currentIdx) continue; // 過去に消化済みの配賦分は現在以降の負荷に含めない
      monthly.set(idx, (monthly.get(idx) ?? 0) + perMonth);
    }
  }

  const crLoads: CrResourceLoad[] = crIds.map((crId) => {
    const headcount = headcountByCr[crId];
    const monthly = monthlyByCr.get(crId) ?? new Map();
    const referenceGrossProfit1m = monthly.get(currentIdx) ?? 0;
    const referenceGrossProfit3m = targetMonths.reduce((sum, idx) => sum + (monthly.get(idx) ?? 0), 0);

    const requiredPersonDays1m = referenceGrossProfit1m / STANDARD_GROSS_PROFIT_PER_PERSON_DAY;
    const requiredPersonDays3m = referenceGrossProfit3m / STANDARD_GROSS_PROFIT_PER_PERSON_DAY;
    const availablePersonDays1m = headcount * AVAILABLE_PERSON_DAYS_PER_MONTH;
    const availablePersonDays3m = availablePersonDays1m * 3;

    return {
      crId,
      headcount,
      referenceGrossProfit1m,
      referenceGrossProfit3m,
      requiredPersonDays1m,
      requiredPersonDays3m,
      availablePersonDays1m,
      availablePersonDays3m,
      loadRate1m: availablePersonDays1m === 0 ? 0 : (requiredPersonDays1m / availablePersonDays1m) * 100,
      loadRate3m: availablePersonDays3m === 0 ? 0 : (requiredPersonDays3m / availablePersonDays3m) * 100,
    };
  });

  return { crLoads, anomalyCount };
}
