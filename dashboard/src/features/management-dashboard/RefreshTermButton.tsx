"use client";

import { useFreeeRefresh } from "./RefreshOverlay";

interface RefreshTermButtonProps {
  term: number;
  /** ボタンの表示文言 */
  label?: string;
}

/** 表示中の「{term}期通期」列をfreeeから再取得してFirestore(termCashFlowSnapshots)を
 * 更新するボタン(ユーザー確定、2026-09-18)。RefreshMonthButtonの通期版 */
export function RefreshTermButton({ term, label = "この期をfreeeから更新" }: RefreshTermButtonProps) {
  const { status, busy, refresh } = useFreeeRefresh("/api/freee/monthly-finance/refresh-term", { term });

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={refresh}
        disabled={busy}
        className="rounded border border-[var(--border-hairline)] bg-[var(--surface-1)] px-2 py-1 text-xs text-[var(--text-secondary)] disabled:opacity-50"
      >
        {busy ? "更新中..." : label}
      </button>
      {status === "error" && <span className="text-xs text-red-600">更新に失敗しました</span>}
    </div>
  );
}
