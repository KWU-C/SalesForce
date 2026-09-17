import type { PipelineDeal, ProcessMemo } from "@/domain/types";

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
 * 「チェック済み」とみなす先頭記号。「●」(U+25CF、CR1〜3で使用実績あり)に加えて
 * 「⚫」(U+26AB、CR4の一部メモで使用。見た目はほぼ同じだが別のコードポイント)も対象にする
 * (実データでCR4の複数案件がこの文字を使っており●判定から漏れていたことを確認、
 * ユーザー報告により追加、2026-09-17)。
 */
const HIGHLIGHT_BULLETS = ["●", "⚫"];

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
  const trimmed = input.salesforceMemo?.trimStart() ?? "";
  const hasBullet = HIGHLIGHT_BULLETS.some((bullet) => trimmed.startsWith(bullet));

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

/**
 * PipelineDealRowが内部で使うresolveHighlightedと同じ入力の組み立てを、
 * 一覧の並び替え(チェック済みを上に)のためにグループ側からも呼べるようにしたもの。
 * 行コンポーネントのローカルstateとは無関係に、propsだけから同じ実効値を再計算する。
 */
export function isDealHighlighted(deal: PipelineDeal, memo: ProcessMemo | undefined): boolean {
  return resolveHighlighted({
    salesforceMemo: deal.salesforceMemo,
    salesforceMemoUpdatedAt: deal.salesforceMemoUpdatedAt,
    dashboardHighlighted: memo?.highlighted ?? false,
    dashboardHighlightedUpdatedAt: memo?.highlightedUpdatedAt,
  });
}

/**
 * 案件一覧(確度グループ内)を、チェック済み(isDealHighlighted)が上に来るよう並び替える
 * (ユーザー確定、2026-09-17)。Array.sortは安定ソートのため、チェック有無が同じ案件
 * 同士の相対順序(呼び出し元の既存順=SOQLの受注確度→クライアント名順)は保たれる。
 */
export function sortHighlightedFirst(
  deals: PipelineDeal[],
  memosByProcessId: Record<string, ProcessMemo>
): PipelineDeal[] {
  return [...deals].sort(
    (a, b) =>
      Number(isDealHighlighted(b, memosByProcessId[b.processId])) -
      Number(isDealHighlighted(a, memosByProcessId[a.processId]))
  );
}
