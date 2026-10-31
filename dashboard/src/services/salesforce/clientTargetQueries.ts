/**
 * クライアント別目標タブ(/client-targets)用のSOQL組み立て。
 * 営業進捗タブのクエリ(salesforceQueries.ts)とは独立させ、受注確定の条件
 * (受注確度A・受注確定フェーズ)だけを共有する。実績のCR合計が営業進捗タブの
 * 受注・完了と一致するようにするため(ユーザー確定、2026-10-14)。
 *
 * clientName__cはSOQLのGROUP BYに使えない数式項目のため、いずれも明細のまま
 * 取得し、アプリ側(features/client-targets/clientTargets.ts)で集計する。
 * 明細取得クエリはフィールドエイリアスが使えないため、レスポンスのキーは
 * フィールドAPI名そのまま(salesforceQueries.tsのクライアントランキング参照)。
 */
import { CONFIRMED_PHASE_CLAUSE, crInClause } from "./salesforceQueries";

/** Profit__cの「目標」レコードタイプ。既存のSalesforceレポート「クライアント別目標進捗」と同じ目標データ */
const TARGET_RECORD_TYPE_DEVELOPER_NAME = "mokuhyo";

/**
 * クライアント別目標(Profit__c「目標」レコード、CR×クライアント×月で1行)。
 * 案件に紐づかない目標行ではbumon__c=部門(bumonmei__c)、clientName__c=クライアント(client__c)名、
 * 月はkobetsuuriagebi__c(個別売上日)。クライアント未指定(client__c空)のCR目標枠もそのまま取得する。
 */
export function buildClientTargetRowsQuery(
  dateRange: { start: string; end: string },
  crIds: readonly string[]
): string {
  return `SELECT bumon__c, clientName__c, kobetsuuriagebi__c, mokuhyoarari__c
    FROM Profit__c
    WHERE RecordType.DeveloperName = '${TARGET_RECORD_TYPE_DEVELOPER_NAME}'
      AND bumon__c IN (${crInClause(crIds)})
      AND kobetsuuriagebi__c >= ${dateRange.start} AND kobetsuuriagebi__c <= ${dateRange.end}`;
}

/** 完了粗利の明細(請求日基準、営業進捗タブの「完了」と同じ条件) */
export function buildClientCompletedRowsQuery(
  dateRange: { start: string; end: string },
  crIds: readonly string[]
): string {
  return `SELECT bumonna__c, clientName__c, seikyuubi__c, arari__c
    FROM Process__c
    WHERE bumonna__c IN (${crInClause(crIds)})
      AND juchukakudo__c = 'A (80～100%)'
      AND ${CONFIRMED_PHASE_CLAUSE}
      AND seikyuubi__c >= ${dateRange.start} AND seikyuubi__c <= ${dateRange.end}`;
}

/** 受注粗利の明細(受注日基準、営業進捗タブの「受注」と同じ条件) */
export function buildClientOrderRowsQuery(
  dateRange: { start: string; end: string },
  crIds: readonly string[]
): string {
  return `SELECT bumonna__c, clientName__c, juchuubi__c, arari__c
    FROM Process__c
    WHERE bumonna__c IN (${crInClause(crIds)})
      AND juchuubi__c != null
      AND juchukakudo__c = 'A (80～100%)'
      AND ${CONFIRMED_PHASE_CLAUSE}
      AND juchuubi__c >= ${dateRange.start} AND juchuubi__c <= ${dateRange.end}`;
}

/**
 * 「担当者」列用: 目標レコードのクライアント(client__c、Account参照)の社内担当者(Tantosha__c)。
 * 注力クライアントタブの社内担当と同じ項目(ユーザー確定、2026-10-31)。
 * client__r.Tantosha__r.Nameは非集計クエリのため、レスポンスでは入れ子のオブジェクトで返る。
 */
export function buildClientInChargeRowsQuery(
  dateRange: { start: string; end: string },
  crIds: readonly string[]
): string {
  return `SELECT bumon__c, clientName__c, client__r.Tantosha__r.Name
    FROM Profit__c
    WHERE RecordType.DeveloperName = '${TARGET_RECORD_TYPE_DEVELOPER_NAME}'
      AND bumon__c IN (${crInClause(crIds)})
      AND client__c != null
      AND kobetsuuriagebi__c >= ${dateRange.start} AND kobetsuuriagebi__c <= ${dateRange.end}`;
}
