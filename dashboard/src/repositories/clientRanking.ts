import type { ClientRanking, CrId } from "@/domain/types";

/** SOQL集計クエリ（buildOrder/CompletedClientRankingQuery）の1行 */
export interface ClientAggregateRow {
  crId: string;
  clientId: string;
  grossProfit: number;
}

const TOP_N = 20;

/**
 * クライアント別集計行を、指定CR(ALLの場合は全CR横断で再集計)でランキングする。
 * ALLは単純に全行を合算するのではなく、クライアント単位でCRをまたいで合算し直す
 * （同じクライアントが複数CRにまたがって取引している場合、二重の別クライアント
 * 扱いにならないようにするため）。
 */
export function rankClients(
  rows: ClientAggregateRow[],
  crId: CrId,
  clientNames: Map<string, string>,
  newClientIds: Set<string>,
  limit: number = TOP_N
): ClientRanking[] {
  const inScope = crId === "ALL" ? rows : rows.filter((r) => r.crId === crId);

  const byClient = new Map<string, number>();
  for (const row of inScope) {
    byClient.set(row.clientId, (byClient.get(row.clientId) ?? 0) + row.grossProfit);
  }

  return [...byClient.entries()]
    .map(([clientId, grossProfit]) => ({
      clientId,
      clientName: clientNames.get(clientId) ?? clientId,
      isNewThisTerm: newClientIds.has(clientId),
      grossProfit,
    }))
    .sort((a, b) => b.grossProfit - a.grossProfit)
    .slice(0, limit);
}
