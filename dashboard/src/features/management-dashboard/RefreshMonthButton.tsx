"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface RefreshMonthButtonProps {
  fiscalYear: number;
  month: number;
  /** ボタンの表示文言。省略時は「この月をfreeeから更新」(過去月列用のデフォルト) */
  label?: string;
  /** 当期累計サマリー(financialSummarySnapshots)も併せて再取得する。ヘッダーの
   * 当月まとめ更新ボタン用(ユーザー確定、2026-09-18)。月次資金収支・借入状況・
   * 資金の備えの3つは常に再取得する(既存動作のまま) */
  includeFinancialSummary?: boolean;
}

/** 表示中の月をfreeeから再取得してFirestoreキャッシュを更新するボタン */
export function RefreshMonthButton({
  fiscalYear,
  month,
  label = "この月をfreeeから更新",
  includeFinancialSummary = false,
}: RefreshMonthButtonProps) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "refreshing" | "error">("idle");

  async function handleClick() {
    setStatus("refreshing");
    try {
      const res = await fetch("/api/freee/monthly-finance/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fiscalYear, month, includeFinancialSummary }),
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
        {status === "refreshing" ? "更新中..." : label}
      </button>
      {status === "error" && <span className="text-xs text-red-600">更新に失敗しました</span>}
    </div>
  );
}
