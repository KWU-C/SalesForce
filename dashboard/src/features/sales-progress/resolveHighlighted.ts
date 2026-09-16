export interface ResolveHighlightedInput {
  /** Salesforce側の既存メモ(memo__c) */
  salesforceMemo: string | null;
  /** Process__cレコードの最終更新日時(ISO8601、LastModifiedDate) */
  salesforceMemoUpdatedAt: string;
  /** ダッシュボード側(Firestore)の現在のhighlighted値。未保存(初回)ならfalse */
  dashboardHighlighted: boolean;
  /** ダッシュボード側でhighlightedを最後に手動変更した日時(ISO8601)。一度も無ければundefined */
  dashboardHighlightedUpdatedAt: string | undefined;
}

/**
 * 案件一覧のチェックボックス(highlighted)の実効値を決める(ユーザー確定、2026-09-16)。
 *
 * - Salesforceメモが「●」で始まる場合は基本的にチェック扱いにする
 * - ダッシュボード側で一度も手動変更されていなければ、Salesforceの●をそのまま採用する
 * - 手動変更済みで、かつ●の有無と食い違っている(コンフリクト)場合は、
 *   Salesforceメモの更新日時とダッシュボードの手動変更日時を比較し、新しい方を採用する
 *   (例: ●を外した後にダッシュボードで手動チェックを外した→ダッシュボードが新しいので
 *   そちらを維持。その後Salesforce側でメモが再度更新され●が付いた→Salesforceの方が
 *   新しくなるので●を再度採用する)
 */
export function resolveHighlighted(input: ResolveHighlightedInput): boolean {
  const hasBullet = input.salesforceMemo?.trimStart().startsWith("●") ?? false;

  if (input.dashboardHighlightedUpdatedAt === undefined) {
    return hasBullet;
  }

  if (hasBullet === input.dashboardHighlighted) {
    return hasBullet;
  }

  const salesforceTime = new Date(input.salesforceMemoUpdatedAt).getTime();
  const dashboardTime = new Date(input.dashboardHighlightedUpdatedAt).getTime();
  return salesforceTime > dashboardTime ? hasBullet : input.dashboardHighlighted;
}
