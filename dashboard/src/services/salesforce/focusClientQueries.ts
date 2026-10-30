/**
 * 注力クライアント管理タブ(/focus-clients)用のSOQL組み立て。
 *
 * 会社の突合キーはclientAccountId__c(クライアント名kuraiantomei__cのAccount IDを返す数式項目、
 * 2026-10-15新設)。clientAccountId__cは数式項目のためGROUP BYできず、明細のまま取得してアプリ側で集計する。
 */

/** SalesforceのId(15/18桁英数字)以外はSOQLに埋め込まない */
const SALESFORCE_ID_PATTERN = /^[a-zA-Z0-9]{15,18}$/;

export function isSalesforceId(value: unknown): value is string {
  return typeof value === "string" && SALESFORCE_ID_PATTERN.test(value);
}

/**
 * 注力クライアントの当期の案件。次のいずれかに当たる案件を取得する:
 * - 受注日・請求日・売上予定日のいずれかが当期内
 * - 進行中(提案・見積)で、日付が未入力のまま当期内に作成された案件
 * 前期以前に作られて日付が当期外・未入力のまま残っている進行中案件は含めない(当期の案件だけを見る、ユーザー指示 2026-10-19)。
 * 失注案件も一覧に残すため除外しない(集計側で実績から外す)。失注日の項目は無い。
 */
export function buildFocusClientDealsQuery(
  accountIds: readonly string[],
  dateRange: { start: string; end: string }
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
  return `SELECT Id, Name, clientAccountId__c, phase__c, juchukakudo__c, bumonna__c, eigyoutantousha__r.Name,
      uriagegoukei__c, arari__c, juchuubi__c, seikyuubi__c, uriageyoteibi__c, shicchu_riyu__c
    FROM Process__c
    WHERE clientAccountId__c IN (${ids})
      AND (${conditions.join(" OR ")})`;
}

/** 注力クライアントの対象区分(Account.target__c)。Salesforceのリストビュー「注力及び振興クライアント」と同じ条件 */
export const FOCUS_TARGET_CATEGORIES = ["注力", "掘り起こし"] as const;

/**
 * 注力クライアントの一覧(Salesforce取引先が正、ユーザー確定 2026-10-30)。
 * CRタブは社内担当(Tantosha__c)のユーザーの部署で振り分けるため、部署も参照で取る。
 * accountIdを渡すと、その取引先が注力クライアントかどうかの確認に使える。
 */
export function buildFocusAccountsQuery(accountId?: string): string {
  const categories = FOCUS_TARGET_CATEGORIES.map((c) => `'${c}'`).join(",");
  if (accountId !== undefined && !isSalesforceId(accountId)) throw new Error("buildFocusAccountsQuery: 不正なAccount IDです");
  const idCondition = accountId !== undefined ? ` AND Id = '${accountId}'` : "";
  return `SELECT Id, Name, target__c, Tantosha__r.Name, Tantosha__r.Department, Thema__c,
      mokuhyouuriage_eigyou__c, mokuhyouarari_eigyou__c
    FROM Account
    WHERE target__c IN (${categories})${idCondition}`;
}
