import type { ClientRanking, CrId } from "@/domain/types";

/**
 * SOQL明細クエリ（buildOrder/CompletedClientRankingQuery）の1行。
 * クライアント名の名寄せキーはclientName__c(文字列)のみ。Account Idのような
 * 安定した識別子は連携ユーザーのライセンス制約で取得できない
 * （services/salesforce/salesforceQueries.tsのコメント参照）。
 */
export interface ClientDetailRow {
  crId: string;
  clientName: string | null;
  grossProfit: number | null;
}

const TOP_N = 20;

/**
 * クライアント別に明細行を合算し、粗利降順で上位を返す。
 * ALLはCRをまたいで同名クライアントを合算し直す。
 * 新規クライアント判定は現状取得できないため、isNewThisTermは常にfalse
 * （Account.kuraiantogurupumei__cが同じライセンス制約で読めないため。
 * 2026-08-24時点、将来的な橋渡し用フィールド追加やライセンス変更を検討中）。
 */
export function rankClients(
  rows: ClientDetailRow[],
  crId: CrId,
  limit: number = TOP_N
): ClientRanking[] {
  const inScope = crId === "ALL" ? rows : rows.filter((r) => r.crId === crId);

  const byClientName = new Map<string, number>();
  for (const row of inScope) {
    if (!row.clientName) continue;
    byClientName.set(row.clientName, (byClientName.get(row.clientName) ?? 0) + (row.grossProfit ?? 0));
  }

  return [...byClientName.entries()]
    .map(([clientName, grossProfit]) => ({
      clientId: clientName,
      clientName,
      isNewThisTerm: false,
      grossProfit,
    }))
    .sort((a, b) => b.grossProfit - a.grossProfit)
    .slice(0, limit);
}
