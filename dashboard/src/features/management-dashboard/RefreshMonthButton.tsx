"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface RefreshMonthButtonProps {
  fiscalYear: number;
  month: number;
}

/** 表示中の月をfreeeから再取得してFirestoreキャッシュを更新するボタン */
export function RefreshMonthButton({ fiscalYear, month }: RefreshMonthButtonProps) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "refreshing" | "error">("idle");

  async function handleClick() {
    setStatus("refreshing");
    try {
      const res = await fetch("/api/freee/monthly-finance/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fiscalYear, month }),
      });
      if (!res.ok) {
        setStatus("error");
        return;
      }
      setStatus("idle");
      router.refresh();
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={status === "refreshing"}
        className="rounded border border-[var(--border-hairline)] bg-[var(--surface-1)] px-2 py-1 text-xs text-[var(--text-secondary)] disabled:opacity-50"
      >
        {status === "refreshing" ? "更新中..." : "この月をfreeeから更新"}
      </button>
      {status === "error" && <span className="text-xs text-red-600">更新に失敗しました</span>}
    </div>
  );
}
