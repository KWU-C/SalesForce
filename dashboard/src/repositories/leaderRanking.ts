import type { CrId, LeaderRanking } from "@/domain/types";

/**
 * SOQL集計クエリ（buildOrder/CompletedLeaderRankingQuery）の1行。
 * リーダーはrida__c(Userへの参照)が安定した識別子として使えるため、
 * クライアントランキングと違い名前だけで名寄せする必要はない
 * （Accountと違いUserはライセンス制約を受けず、GROUP BYでのエイリアスも
 * 問題なく使える。2026-08-24確認）。
 */
export interface LeaderAggregateRow {
  crId: string;
  leaderId: string | null;
  leaderName: string | null;
  grossProfit: number;
}

const TOP_N = 20;

/**
 * リーダー別に集計行を合算し、粗利降順で上位を返す。
 * ALLはCRをまたいで同一リーダーを合算し直す（通常リーダーは単一CR所属だが、
 * 念のためクライアントランキングと同じ考え方で再集計する）。
 */
export function rankLeaders(
  rows: LeaderAggregateRow[],
  crId: CrId,
  limit: number = TOP_N
): LeaderRanking[] {
  const inScope = crId === "ALL" ? rows : rows.filter((r) => r.crId === crId);

  const byLeaderId = new Map<string, { leaderName: string; grossProfit: number }>();
  for (const row of inScope) {
    if (!row.leaderId) continue;
    const acc = byLeaderId.get(row.leaderId) ?? {
      leaderName: row.leaderName ?? row.leaderId,
      grossProfit: 0,
    };
    acc.grossProfit += row.grossProfit;
    byLeaderId.set(row.leaderId, acc);
  }

  return [...byLeaderId.entries()]
    .map(([leaderId, acc]) => ({ leaderId, leaderName: acc.leaderName, grossProfit: acc.grossProfit }))
    .sort((a, b) => b.grossProfit - a.grossProfit)
    .slice(0, limit);
}
