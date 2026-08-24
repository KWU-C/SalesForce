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
 * 受注/完了 クライアント別粗利ランキング用の明細取得（CR×クライアント別に
 * アプリ側で集計する。SOQL側ではGROUP BYしない）。
 *
 * 重要な制約: ダッシュボード連携ユーザーのユーザーライセンスは
 * 「Salesforce Integration」で、Account等の標準オブジェクトへは
 * プラットフォーム制約で一切アクセスできない（2026-08-24確認、権限セットの
 * 追加設定では回避不可）。そのためAccountへの参照(kuraiantomei__c)は使わず、
 * 同じ値をProcess__c上に実体化した数式フィールドclientName__c
 * （kuraiantomei__r.Name、帳票用）を使う。ただしclientName__cはSOQLの
 * GROUP BY対象にできない仕様のため、明細行のまま取得しアプリ側
 * （repositories/clientRanking.ts）で合算する。
 *
 * 現状クライアント名(文字列)でしか名寄せできず、Account Idのような安定した
 * 識別子は使えない（同名クライアントがあれば合算されてしまう）。
 *
 * 「今期新規」判定用にclientGroupName__c（kuraiantomei__r.kuraiantogurupumei__c、
 * clientName__cと同じ発想の橋渡し用数式フィールド、2026-08-24追加）も取得する。
 * Process__c側のobjectPermissions.viewAllFields=trueが既存フィールド同様に
 * 適用されるため、追加の権限設定は不要だった（実機確認済み）。
 *
 * 列エイリアスは付けない: SOQLではGROUP BYを伴わない非集計クエリで
 * フィールドエイリアシングを使うと"only aggregate expressions use field
 * aliasing"エラーになる（2026-08-24、本番で実際に踏んだ）。レスポンスの
 * キーはフィールドAPI名(bumonna__c/clientName__c/clientGroupName__c/arari__c)
 * そのものになるため、呼び出し側でその名前のまま受け取る。
 */
export function buildOrderClientRankingQuery(dateRange: { start: string; end: string }): string {
  return `SELECT bumonna__c, clientName__c, clientGroupName__c, arari__c
    FROM Process__c
    WHERE bumonna__c IN (${crInClause()})
      AND juchuubi__c != null
      AND juchukakudo__c = 'A (80～100%)'
      AND phase__c != '失注'
      AND juchuubi__c >= ${dateRange.start} AND juchuubi__c <= ${dateRange.end}`;
}

export function buildCompletedClientRankingQuery(dateRange: { start: string; end: string }): string {
  return `SELECT bumonna__c, clientName__c, clientGroupName__c, arari__c
    FROM Process__c
    WHERE bumonna__c IN (${crInClause()})
      AND juchukakudo__c = 'A (80～100%)'
      AND phase__c != '失注'
      AND seikyuubi__c >= ${dateRange.start} AND seikyuubi__c <= ${dateRange.end}`;
}

/**
 * 受注/完了 リーダー別粗利ランキング用の集計（CR×リーダーごと）。
 * rida__c(リーダー=Userへの参照)はkuraiantomei__c(Account)と違いライセンス
 * 制約を受けず、GROUP BYでの通常のフィールドエイリアシングも問題なく使える
 * （2026-08-24確認、集計クエリなのでaliasingは合法）。そのためクライアント
 * ランキングのような明細取得+アプリ側集計は不要で、通常の集計クエリで済む。
 */
export function buildOrderLeaderRankingQuery(dateRange: { start: string; end: string }): string {
  return `SELECT bumonna__c crId, rida__c leaderId, rida__r.Name leaderName, SUM(arari__c) grossProfit
    FROM Process__c
    WHERE bumonna__c IN (${crInClause()})
      AND juchuubi__c != null
      AND juchukakudo__c = 'A (80～100%)'
      AND phase__c != '失注'
      AND juchuubi__c >= ${dateRange.start} AND juchuubi__c <= ${dateRange.end}
    GROUP BY bumonna__c, rida__c, rida__r.Name`;
}

export function buildCompletedLeaderRankingQuery(dateRange: { start: string; end: string }): string {
  return `SELECT bumonna__c crId, rida__c leaderId, rida__r.Name leaderName, SUM(arari__c) grossProfit
    FROM Process__c
    WHERE bumonna__c IN (${crInClause()})
      AND juchukakudo__c = 'A (80～100%)'
      AND phase__c != '失注'
      AND seikyuubi__c >= ${dateRange.start} AND seikyuubi__c <= ${dateRange.end}
    GROUP BY bumonna__c, rida__c, rida__r.Name`;
}
