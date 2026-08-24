/**
 * Process__cに対するSOQL組み立て。
 *
 * 「完了」の定義（請求日＋受注確度A＋失注除外）は
 * ユーザー確定・検算済み（docs/salesforce-reconciliation-2025-09-11.md）。
 * 「受注」の定義（受注日＋受注確度A＋失注除外）は2026-08-17にユーザーが
 * 「受注確定分＝受注・納品・請求・入金を全て含む、確度A（80〜100%）のみ」として確定。
 * ここでは組み立てのみ行い、実行はsalesforceClient.query()に委ねる。
 */

const CR_IDS = ["CR1", "CR2", "CR3"] as const;

function crInClause(): string {
  return CR_IDS.map((id) => `'${id}'`).join(",");
}

/** 受注進捗（月別・CRごとの集計） */
export function buildOrderProgressQuery(dateRange: { start: string; end: string }): string {
  return `SELECT bumonna__c crId, CALENDAR_MONTH(juchuubi__c) mo,
    SUM(uriagegoukei__c) sales, SUM(arari__c) grossProfit
    FROM Process__c
    WHERE bumonna__c IN (${crInClause()})
      AND juchuubi__c != null
      AND juchukakudo__c = 'A (80～100%)'
      AND phase__c != '失注'
      AND juchuubi__c >= ${dateRange.start} AND juchuubi__c <= ${dateRange.end}
    GROUP BY bumonna__c, CALENDAR_MONTH(juchuubi__c)`;
}

/** 完了進捗（月別・CRごとの集計） */
export function buildCompletedProgressQuery(dateRange: { start: string; end: string }): string {
  return `SELECT bumonna__c crId, CALENDAR_MONTH(seikyuubi__c) mo,
    SUM(uriagegoukei__c) sales, SUM(arari__c) grossProfit
    FROM Process__c
    WHERE bumonna__c IN (${crInClause()})
      AND juchukakudo__c = 'A (80～100%)'
      AND phase__c != '失注'
      AND seikyuubi__c >= ${dateRange.start} AND seikyuubi__c <= ${dateRange.end}
    GROUP BY bumonna__c, CALENDAR_MONTH(seikyuubi__c)`;
}

/** 年間目標（SalesTarget__c、事業期ごとに1レコード） */
export function buildSalesTargetQuery(term: number): string {
  return `SELECT TargetSales__c, TargetGrossProfit__c FROM SalesTarget__c WHERE Term__c = ${term} LIMIT 1`;
}

/**
 * 受注/完了 クライアント別粗利ランキング用の集計（CR×クライアントごと）。
 * 業務条件（確度A・失注除外・日付範囲）は月別集計クエリと同一、CALENDAR_MONTHの
 * 代わりにkuraiantomei__c(クライアント=Account参照)でグルーピングする。
 */
export function buildOrderClientRankingQuery(dateRange: { start: string; end: string }): string {
  return `SELECT bumonna__c crId, kuraiantomei__c clientId, SUM(arari__c) grossProfit
    FROM Process__c
    WHERE bumonna__c IN (${crInClause()})
      AND juchuubi__c != null
      AND juchukakudo__c = 'A (80～100%)'
      AND phase__c != '失注'
      AND juchuubi__c >= ${dateRange.start} AND juchuubi__c <= ${dateRange.end}
    GROUP BY bumonna__c, kuraiantomei__c`;
}

export function buildCompletedClientRankingQuery(dateRange: { start: string; end: string }): string {
  return `SELECT bumonna__c crId, kuraiantomei__c clientId, SUM(arari__c) grossProfit
    FROM Process__c
    WHERE bumonna__c IN (${crInClause()})
      AND juchukakudo__c = 'A (80～100%)'
      AND phase__c != '失注'
      AND seikyuubi__c >= ${dateRange.start} AND seikyuubi__c <= ${dateRange.end}
    GROUP BY bumonna__c, kuraiantomei__c`;
}

const SALESFORCE_ID_PATTERN = /^[a-zA-Z0-9]{15,18}$/;

/**
 * クライアント名・クライアントグループ名（新規判定用）の解決。
 * clientIdsは直前のクエリ結果由来のSalesforce IdのみでSOQLに埋め込む
 * （不正な形式のIdは無視してクエリインジェクションを避ける）。
 */
export function buildClientNamesQuery(clientIds: string[]): string {
  const idList = clientIds
    .filter((id) => SALESFORCE_ID_PATTERN.test(id))
    .map((id) => `'${id}'`)
    .join(",");
  return `SELECT Id, Name, kuraiantogurupumei__c FROM Account WHERE Id IN (${idList})`;
}
