import type { PipelineDeal } from "@/domain/types";

export interface PipelineDealGroup {
  confidence: string;
  deals: PipelineDeal[];
  /** 受注確度A・Bグループのみ粗利合計を持つ（ユーザー確定、それ以外はnull） */
  grossProfitSubtotal: number | null;
}

/** 受注確度ラベルが"A "または"B "で始まる場合のみ粗利合計行を追加する（ユーザー確定） */
function hasGrossProfitSubtotal(confidence: string): boolean {
  return confidence.startsWith("A ") || confidence.startsWith("B ");
}

/**
 * パイプライン案件を受注確度ごとにグルーピングし、A・Bグループのみ粗利合計を付与する。
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
      grossProfitSubtotal: hasGrossProfitSubtotal(confidence)
        ? groupDeals.reduce((sum, d) => sum + (d.grossProfit ?? 0), 0)
        : null,
    }));
}
