"use client";

import { useState } from "react";
import { ProcessMemoEditor } from "@/components/ProcessMemoEditor";
import type { ConcreteCrId, PipelineDeal, ProcessMemo } from "@/domain/types";
import { isMemoStale } from "@/features/sales-progress/memoStaleness";
import { resolveHighlighted } from "@/features/sales-progress/resolveHighlighted";
import { formatDateTime, formatThousandYen } from "@/utils/format";

interface PipelineDealRowProps {
  deal: PipelineDeal;
  crId: ConcreteCrId;
  initialMemo: ProcessMemo | undefined;
  /**
   * 保存成功時にDashboardClient側の状態へ反映するコールバック。
   * CRタブ切替でこの行(processIdをkeyに持つ)がアンマウント→再マウントされても
   * 保存済みの値を失わないようにするため（ユーザー報告により追加、2026-09-13）。
   */
  onMemoSaved: (processId: string, memo: ProcessMemo) => void;
}

/**
 * 案件一覧の1行。クライアント名頭のチェックボックスで行全体をハイライト表示する
 * （ユーザー確定）。チェックのon/offはボタン無しでその場で保存される
 * （メモ本文の保存とは独立、processMemoRepository.tsのマージ書き込み参照）。
 *
 * 初期チェック状態はSalesforceメモ先頭の「●」とダッシュボード側の手動チェックを
 * resolveHighlightedで突き合わせて決める(ユーザー確定、2026-09-16。詳細は同関数参照)。
 * 保存後(ユーザーが今まさに手動トグルした直後)はその値をそのまま採用し、
 * 再度resolveHighlightedにはかけない(手動操作が常に最新のため)。
 */
export function PipelineDealRow({ deal, crId, initialMemo, onMemoSaved }: PipelineDealRowProps) {
  const [highlighted, setHighlighted] = useState(() =>
    resolveHighlighted({
      salesforceMemo: deal.salesforceMemo,
      salesforceMemoUpdatedAt: deal.salesforceMemoUpdatedAt,
      dashboardHighlighted: initialMemo?.highlighted ?? false,
      dashboardHighlightedUpdatedAt: initialMemo?.highlightedUpdatedAt,
    })
  );
  const memoStale = isMemoStale(deal.salesforceMemoUpdatedAt);

  async function handleToggle(nextHighlighted: boolean) {
    setHighlighted(nextHighlighted);
    try {
      const response = await fetch(`/api/process-memos/${encodeURIComponent(deal.processId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ crId, highlighted: nextHighlighted }),
      });
      if (!response.ok) throw new Error("save failed");
      const data = (await response.json()) as ProcessMemo;
      setHighlighted(data.highlighted);
      onMemoSaved(deal.processId, data);
    } catch {
      setHighlighted(!nextHighlighted);
    }
  }

  return (
    <tr
      className={`border-b border-[var(--gridline)] align-top last:border-b-0 ${
        highlighted ? "bg-[#fdf3d0]" : ""
      }`}
    >
      <td className="px-4 py-2 text-[var(--text-primary)]">
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={highlighted}
            onChange={(e) => handleToggle(e.target.checked)}
            className="mt-0.5 shrink-0"
          />
          <span>{deal.clientName ?? "—"}</span>
        </label>
      </td>
      <td className="px-2 py-2 text-[var(--text-primary)]">{deal.dealName}</td>
      <td className="px-2 py-2 text-right font-medium tabular-nums text-[var(--text-primary)]">
        {deal.grossProfit === null ? "—" : formatThousandYen(deal.grossProfit)}
      </td>
      <td className="px-2 py-2">
        <div className="flex flex-col gap-2">
          <p className="whitespace-pre-wrap text-[var(--text-primary)]">
            {deal.salesforceMemo || "—"}
          </p>
          <p className={`text-[10px] ${memoStale ? "text-[var(--status-critical)]" : "text-[var(--text-muted)]"}`}>
            案件: 最終更新日 {formatDateTime(new Date(deal.salesforceMemoUpdatedAt))}
          </p>
          <ProcessMemoEditor
            processId={deal.processId}
            crId={crId}
            initialMemo={initialMemo}
            onSaved={onMemoSaved}
          />
        </div>
      </td>
    </tr>
  );
}
