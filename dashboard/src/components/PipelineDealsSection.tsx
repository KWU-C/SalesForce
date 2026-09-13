"use client";

import { PipelineDealRow } from "@/components/PipelineDealRow";
import type { ConcreteCrId, PipelineDeal, ProcessMemo } from "@/domain/types";
import { groupPipelineDealsByConfidence } from "@/features/sales-progress/pipelineGrouping";
import { formatThousandYen } from "@/utils/format";

interface PipelineDealsSectionProps {
  crId: ConcreteCrId;
  /** WOM_CR1〜4相当のパイプライン案件一覧（提案・見積フェーズ、現在時点のスナップショット） */
  deals: PipelineDeal[];
  memosByProcessId: Record<string, ProcessMemo>;
  /** 保存成功時にDashboardClient側の状態へ反映するコールバック（CRタブ切替対策） */
  onMemoSaved: (processId: string, memo: ProcessMemo) => void;
}

export function PipelineDealsSection({
  crId,
  deals,
  memosByProcessId,
  onMemoSaved,
}: PipelineDealsSectionProps) {
  const groups = groupPipelineDealsByConfidence(deals);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-medium text-[var(--text-secondary)]">案件一覧（提案・見積）</h3>
        <span className="text-xs text-[var(--text-muted)]">粗利単位：千円</span>
      </div>
      {groups.length === 0 ? (
        <p className="rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)] px-4 py-6 text-center text-sm text-[var(--text-muted)]">
          対象データなし
        </p>
      ) : (
        <div className="flex flex-col gap-[50px]">
          {groups.map((group) => (
            <div
              key={group.confidence}
              className="overflow-hidden rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)]"
            >
              <div className="border-b border-[var(--border-hairline)] px-4 py-2">
                <h4 className="text-sm font-medium text-[var(--text-primary)]">{group.confidence}</h4>
              </div>
              <table className="w-full table-fixed text-sm">
                <thead>
                  <tr className="border-b border-[var(--gridline)] text-left text-xs text-[var(--text-muted)]">
                    <th className="w-[15%] px-4 py-1.5 font-normal">クライアント名</th>
                    <th className="w-[25%] px-2 py-1.5 font-normal">案件名</th>
                    <th className="w-[10%] px-2 py-1.5 text-right font-normal">粗利</th>
                    <th className="w-1/2 px-2 py-1.5 font-normal">メモ</th>
                  </tr>
                </thead>
                <tbody>
                  {group.deals.map((deal) => (
                    <PipelineDealRow
                      key={deal.processId}
                      deal={deal}
                      crId={crId}
                      initialMemo={memosByProcessId[deal.processId]}
                      onMemoSaved={onMemoSaved}
                    />
                  ))}
                  {group.grossProfitSubtotal !== null && (
                    <tr className="bg-[var(--surface-sunken)] font-medium">
                      <td className="px-4 py-2 text-[var(--text-secondary)]" colSpan={2}>
                        粗利合計
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-[var(--text-primary)]">
                        {formatThousandYen(group.grossProfitSubtotal)}
                      </td>
                      <td />
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
