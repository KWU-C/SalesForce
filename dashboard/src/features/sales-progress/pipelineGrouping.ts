import type { PipelineDeal } from "@/domain/types";

export interface PipelineDealGroup {
  confidence: string;
  deals: PipelineDeal[];
  /** 受注確度A・Bグループのみ粗利合計を持つ（ユーザー確定、それ以外はnull） */
  grossProfitSubtotal: number | null;
  /** 受注確度A・Bグループのみ売上合計を持つ（粗利合計と同じ基準、それ以外はnull） */
  salesSubtotal: number | null;
}

/** 受注確度ラベルが"A "または"B "で始まる場合のみ合計行を追加する（ユーザー確定） */
function hasSubtotal(confidence: string): boolean {
  return confidence.startsWith("A ") || confidence.startsWith("B ");
}

export interface ConfidenceAForecast {
  grossProfit: number;
  sales: number;
}

/**
 * 受注確度Aのパイプライン案件(提案・見積＝未確定)を受注予定日(expectedOrderDate)の暦月ごとに合算する。
 * 月別受注サマリー横の「受注確度A」表示用で、「◯月の受注」(受注確定分)には含まれない
 * その月の受注予測分を表す（ユーザー確定、2026-10-01）。
 * 対象は受注予定日がdateRange(表示中の事業期、両端含むYYYY-MM-DD)内の案件のみ。
 * 受注予定日が未入力の案件はどの月にも計上しない。該当案件の無い月はキー自体を持たない。
 */
export function sumConfidenceAForecastByMonth(
  deals: PipelineDeal[],
  dateRange: { start: string; end: string }
): Map<number, ConfidenceAForecast> {
  const byMonth = new Map<number, ConfidenceAForecast>();
  for (const deal of deals) {
    const date = deal.expectedOrderDate;
    if (!deal.confidence.startsWith("A ") || !date) continue;
    if (date < dateRange.start || date > dateRange.end) continue;
    const month = Number(date.slice(5, 7));
    const total = byMonth.get(month) ?? { grossProfit: 0, sales: 0 };
    total.grossProfit += deal.grossProfit ?? 0;
    total.sales += deal.sales ?? 0;
    byMonth.set(month, total);
  }
  return byMonth;
}

/**
 * パイプライン案件を受注確度ごとにグルーピングし、A・Bグループのみ粗利・売上合計を付与する。
 * グループの並び順は受注確度ラベルの文字列順（A, B, C, D...の順に自然に揃う）。
 */
export function groupPipelineDealsByConfidence(deals: PipelineDeal[]): PipelineDealGroup[] {
  const byConfidence = new Map<string, PipelineDeal[]>();
  for (const deal of deals) {
    const group = byConfidence.get(deal.confidence);
    if (group) {
      group.push(deal);
    } else {
      byConfidence.set(deal.confidence, [deal]);
    }
  }

  return [...byConfidence.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([confidence, groupDeals]) => ({
      confidence,
      deals: groupDeals,
      grossProfitSubtotal: hasSubtotal(confidence)
        ? groupDeals.reduce((sum, d) => sum + (d.grossProfit ?? 0), 0)
        : null,
      salesSubtotal: hasSubtotal(confidence)
        ? groupDeals.reduce((sum, d) => sum + (d.sales ?? 0), 0)
        : null,
    }));
}
