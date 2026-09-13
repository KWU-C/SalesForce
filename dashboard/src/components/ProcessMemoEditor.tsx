"use client";

import { useState } from "react";
import type { ConcreteCrId, ProcessMemo } from "@/domain/types";
import { formatDateTime } from "@/utils/format";

interface ProcessMemoEditorProps {
  processId: string;
  crId: ConcreteCrId;
  initialMemo: ProcessMemo | undefined;
}

/**
 * ダッシュボード独自メモの1件分エディタ。Salesforce側のmemo__cとは別データで、
 * 保存はCloud Run上のAPIルート(/api/process-memos/[processId])経由のみ
 * （ブラウザからFirestoreへ直接アクセスしない、ユーザー確定）。
 */
export function ProcessMemoEditor({ processId, crId, initialMemo }: ProcessMemoEditorProps) {
  const [memo, setMemo] = useState(initialMemo?.memo ?? "");
  const [saved, setSaved] = useState(initialMemo);
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");

  const isDirty = memo !== (saved?.memo ?? "");

  async function saveMemo(nextMemo: string) {
    setStatus("saving");
    try {
      const response = await fetch(`/api/process-memos/${encodeURIComponent(processId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ crId, memo: nextMemo }),
      });
      if (!response.ok) throw new Error("save failed");
      const data = (await response.json()) as ProcessMemo;
      setSaved(data);
      setMemo(data.memo);
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  }

  function handleSave() {
    return saveMemo(memo);
  }

  function handleDelete() {
    return saveMemo("");
  }

  return (
    <div className="flex flex-col gap-1">
      <textarea
        value={memo}
        onChange={(e) => setMemo(e.target.value)}
        rows={2}
        placeholder="このダッシュボード独自のメモ"
        className="w-full resize-y rounded border border-[var(--border-hairline)] bg-[var(--surface-1)] px-2 py-1 text-[var(--text-primary)]"
      />
      <div className="flex items-center justify-between gap-2 text-[10px] text-[var(--text-muted)]">
        <span>
          {saved ? `最終更新: ${saved.updatedBy} ${formatDateTime(new Date(saved.updatedAt))}` : "未保存"}
        </span>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            onClick={handleDelete}
            disabled={!saved?.memo || status === "saving"}
            className="rounded border border-[var(--border-hairline)] px-2 py-0.5 font-medium text-[var(--text-secondary)] disabled:opacity-50"
          >
            削除
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!isDirty || status === "saving"}
            className="rounded border border-[var(--border-hairline)] px-2 py-0.5 font-medium text-[var(--text-secondary)] disabled:opacity-50"
          >
            {status === "saving" ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
      {status === "error" && (
        <span className="text-[10px] text-[var(--status-serious)]">保存に失敗しました</span>
      )}
    </div>
  );
}
