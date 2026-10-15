/**
 * 注力クライアント管理タブ(/focus-clients)用のSOQL組み立て。
 *
 * 会社の突合キーはclientAccountId__c(クライアント名kuraiantomei__cのAccount IDを返す数式項目、
 * 2026-10-15新設)。連携ユーザーはAccountを読めないため、Account参照項目そのもの
 * (kuraiantomei__c)はAPIから見えない。clientAccountId__cは数式項目のためGROUP BYできず、
 * 明細のまま取得してアプリ側で集計する。
 */
import { OPEN_PHASES } from "@/features/focus-clients/focusClients";

/** SalesforceのId(15/18桁英数字)以外はSOQLに埋め込まない */
const SALESFORCE_ID_PATTERN = /^[a-zA-Z0-9]{15,18}$/;

export function isSalesforceId(value: unknown): value is string {
  return typeof value === "string" && SALESFORCE_ID_PATTERN.test(value);
}

/**
 * 注力クライアントの当期の案件。次のいずれかに当たる案件を取得する:
 * - 受注日・請求日・売上予定日のいずれかが当期内
 * - 進行中(提案・見積)で、日付が未入力のまま当期内に作成された案件
 * - includeAllOpen=true(今期表示)のときは、進行中の案件を日付によらず全て
 * 失注案件も一覧に残すため除外しない(集計側で実績から外す)。失注日の項目は無い。
 */
export function buildFocusClientDealsQuery(
  accountIds: readonly string[],
  dateRange: { start: string; end: string },
  includeAllOpen: boolean
): string {
  const ids = accountIds.filter(isSalesforceId).map((id) => `'${id}'`).join(",");
  const inRange = (field: string) => `(${field} >= ${dateRange.start} AND ${field} <= ${dateRange.end})`;
  const createdInRange = `(CreatedDate >= ${dateRange.start}T00:00:00+09:00 AND CreatedDate <= ${dateRange.end}T23:59:59+09:00)`;
  const undated = "(juchuubi__c = null AND seikyuubi__c = null AND uriageyoteibi__c = null)";
  const conditions = [
    inRange("juchuubi__c"),
    inRange("seikyuubi__c"),
    inRange("uriageyoteibi__c"),
    `(${undated} AND ${createdInRange})`,
  ];
  if (includeAllOpen) conditions.push(`phase__c IN (${OPEN_PHASES.map((p) => `'${p}'`).join(",")})`);
  return `SELECT Id, Name, clientAccountId__c, phase__c, juchukakudo__c, bumonna__c, eigyoutantousha__r.Name,
      uriagegoukei__c, arari__c, juchuubi__c, seikyuubi__c, uriageyoteibi__c, shicchu_riyu__c
    FROM Process__c
    WHERE clientAccountId__c IN (${ids})
      AND (${conditions.join(" OR ")})`;
}
