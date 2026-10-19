"use client";

import { useState } from "react";
import { formatDateTime } from "@/utils/format";
import type { FocusClientMaster } from "./focusClients";

interface FocusClientMemoEditorProps {
  master: FocusClientMaster;
  onSaved: (master: FocusClientMaster) => void;
}

/**
 * 注力クライアント一覧の行内メモ。営業進捗タブの案件一覧(提案・見積)のメモ(ProcessMemoEditor)と
 * 同じ操作(保存・削除)にする(ユーザー指示、2026-10-19)。保存先はマスタのmemo項目で、
 * APIルート(/api/focus-clients/[accountId])経由のみ。
 */
export function FocusClientMemoEditor({ master, onSaved }: FocusClientMemoEditorProps) {
  const [memo, setMemo] = useState(master.memo);
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");

  const isDirty = memo !== master.memo;

  async function saveMemo(nextMemo: string) {
    setStatus("saving");
    try {
      const response = await fetch(`/api/focus-clients/${encodeURIComponent(master.accountId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields: { memo: nextMemo } }),
      });
      if (!response.ok) throw new Error("save failed");
      const saved = (await response.json()) as FocusClientMaster;
      setMemo(saved.memo);
      setStatus("idle");
      onSaved(saved);
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <textarea
        value={memo}
        onChange={(e) => setMemo(e.target.value)}
        rows={2}
        placeholder="メモ"
        className="w-full resize-y rounded border border-[var(--border-hairline)] bg-[var(--surface-1)] px-2 py-1 text-xs text-[var(--text-primary)]"
      />
      <div className="flex items-center justify-between gap-2 text-[10px] text-[var(--text-muted)]">
        <span>
          {master.memoUpdatedAt
            ? `最終更新: ${master.memoUpdatedBy ?? ""} ${formatDateTime(new Date(master.memoUpdatedAt))}`
            : "未保存"}
        </span>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            onClick={() => saveMemo("")}
            disabled={!master.memo || status === "saving"}
            className="rounded border border-[var(--border-hairline)] px-2 py-0.5 font-medium text-[var(--text-secondary)] disabled:opacity-50"
          >
            削除
          </button>
          <button
            type="button"
            onClick={() => saveMemo(memo)}
            disabled={!isDirty || status === "saving"}
            className="rounded border border-[var(--border-hairline)] px-2 py-0.5 font-medium text-[var(--text-secondary)] disabled:opacity-50"
          >
            {status === "saving" ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
      {status === "error" && <span className="text-[10px] text-[var(--status-serious)]">保存に失敗しました</span>}
    </div>
  );
}
