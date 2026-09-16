import type { PipelineDeal } from "@/domain/types";

/** buildPipelineDealsQueryの1行 */
export interface PipelineDealRow {
  Id: string;
  Name: string;
  clientName__c: string | null;
  juchukakudo__c: string | null;
  arari__c: number | null;
  uriagegoukei__c: number | null;
  memo__c: string | null;
  /** レコード全体の最終更新日時(ISO8601)。レポート上の「案件: 最終更新日」に相当 */
  LastModifiedDate: string;
}

const UNSPECIFIED_CONFIDENCE_LABEL = "未設定";
const LOST_EXPECTED_MEMO = "失注予定";

/**
 * CR3専用の除外フィルタ（レポート原本の"メモが失注予定の行を除外"を再現）。
 * memo__cはtextarea型でSOQLのWHERE句にできない(filterable:false、実機確認済み、
 * salesforceQueries.tsのbuildPipelineDealsQueryコメント参照)ため、取得後にここで
 * アプリ側フィルタする。`!==`はnullも真(除外しない)として扱うため、SOQLの`!=`が
 * null値を含む(除外しない)のと同じ挙動になる。
 */
export function excludeLostExpectedDeals(rows: PipelineDealRow[]): PipelineDealRow[] {
  return rows.filter((row) => row.memo__c !== LOST_EXPECTED_MEMO);
}

/** WOM_CR1〜4相当のSOQL結果をPipelineDealへ変換する（クエリ自体がCRごとに絞り込み済みのため、ここでの追加フィルタは不要） */
export function mapPipelineDealRows(rows: PipelineDealRow[]): PipelineDeal[] {
  return rows.map((row) => ({
    processId: row.Id,
    confidence: row.juchukakudo__c ?? UNSPECIFIED_CONFIDENCE_LABEL,
    clientName: row.clientName__c,
    dealName: row.Name,
    grossProfit: row.arari__c,
    sales: row.uriagegoukei__c,
    salesforceMemo: row.memo__c,
    salesforceMemoUpdatedAt: row.LastModifiedDate,
  }));
}
