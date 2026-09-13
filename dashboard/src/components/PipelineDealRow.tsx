"use client";

import { useState } from "react";
import { ProcessMemoEditor } from "@/components/ProcessMemoEditor";
import type { ConcreteCrId, PipelineDeal, ProcessMemo } from "@/domain/types";
import { formatThousandYen } from "@/utils/format";

interface PipelineDealRowProps {
  deal: PipelineDeal;
  crId: ConcreteCrId;
  initialMemo: ProcessMemo | undefined;
}

/**
 * 案件一覧の1行。クライアント名頭のチェックボックスで行全体をハイライト表示する
 * （ユーザー確定）。チェックのon/offはボタン無しでその場で保存される
 * （メモ本文の保存とは独立、processMemoRepository.tsのマージ書き込み参照）。
 */
export function PipelineDealRow({ deal, crId, initialMemo }: PipelineDealRowProps) {
  const [highlighted, setHighlighted] = useState(initialMemo?.highlighted ?? false);

  async function handleToggle(nextHighlighted: boolean) {
    setHighlighted(nextHighlighted);
    try {
      const response = await fetch(`/api/process-memos/${encodeURIComponent(deal.processId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ crId, highlighted: nextHighlighted }),
      });
      if (!response.ok) throw new Error("save failed");
    } catch {
      setHighlighted(!nextHighlighted);
    }
  }

  return (
    <tr
      className={`border-b border-[var(--gridline)] align-top last:border-b-0 ${
        highlighted ? "bg-[#ffff66]" : ""
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
          <ProcessMemoEditor processId={deal.processId} crId={crId} initialMemo={initialMemo} />
        </div>
      </td>
    </tr>
  );
}
