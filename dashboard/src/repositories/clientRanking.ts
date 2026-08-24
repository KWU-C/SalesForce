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
  /** クライアントグループ名（例:"49期新規"）。新規判定にのみ使う */
  clientGroupName: string | null;
  grossProfit: number | null;
}

const TOP_N = 20;

/**
 * クライアント別に明細行を合算し、粗利降順で上位を返す。
 * ALLはCRをまたいで同名クライアントを合算し直す。
 * newClientMarkerを含むclientGroupNameを持つ行が1件でもあれば、そのクライアントは
 * isNewThisTerm=trueとする（例:"49期新規"。事業期ごとに変わるため呼び出し側で
 * `${term}期新規`のように動的に組み立てる。ハードコードしない）。
 */
export function rankClients(
  rows: ClientDetailRow[],
  crId: CrId,
  newClientMarker: string,
  limit: number = TOP_N
): ClientRanking[] {
  const inScope = crId === "ALL" ? rows : rows.filter((r) => r.crId === crId);

  const byClientName = new Map<string, { grossProfit: number; isNewThisTerm: boolean }>();
  for (const row of inScope) {
    if (!row.clientName) continue;
    const acc = byClientName.get(row.clientName) ?? { grossProfit: 0, isNewThisTerm: false };
    acc.grossProfit += row.grossProfit ?? 0;
    if (row.clientGroupName?.includes(newClientMarker)) acc.isNewThisTerm = true;
    byClientName.set(row.clientName, acc);
  }

  return [...byClientName.entries()]
    .map(([clientName, acc]) => ({
      clientId: clientName,
      clientName,
      isNewThisTerm: acc.isNewThisTerm,
      grossProfit: acc.grossProfit,
    }))
    .sort((a, b) => b.grossProfit - a.grossProfit)
    .slice(0, limit);
}
