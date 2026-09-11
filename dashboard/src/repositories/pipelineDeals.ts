import type { PipelineDeal } from "@/domain/types";

/** buildPipelineDealsQueryの1行 */
export interface PipelineDealRow {
  Id: string;
  Name: string;
  clientName__c: string | null;
  juchukakudo__c: string | null;
  arari__c: number | null;
  memo__c: string | null;
}

const UNSPECIFIED_CONFIDENCE_LABEL = "未設定";

/** WOM_CR1〜4相当のSOQL結果をPipelineDealへ変換する（クエリ自体がCRごとに絞り込み済みのため、ここでの追加フィルタは不要） */
export function mapPipelineDealRows(rows: PipelineDealRow[]): PipelineDeal[] {
  return rows.map((row) => ({
    processId: row.Id,
    confidence: row.juchukakudo__c ?? UNSPECIFIED_CONFIDENCE_LABEL,
    clientName: row.clientName__c,
    dealName: row.Name,
    grossProfit: row.arari__c,
    salesforceMemo: row.memo__c,
  }));
}
