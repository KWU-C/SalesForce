"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * 経理確認の対象月の指定(2026-11-16)。概要の上段の累計をどの月までにするかだけを保存する(売上・利益の金額は
 * 入力しない)。指定を外すと、暫定の仕掛品振替判定に戻る。保存API側でもIAP検証と許可リストを確認する。
 */
export function AccountingConfirmationForm({
  currentMonth,
  defaultMonth,
  maxMonth,
}: {
  /** 現在の指定(YYYY-MM)。無ければnull */
  currentMonth: string | null;
  /** 入力欄の初期値 */
  defaultMonth: string;
  /** 選べる最後の月(月末を経過した最新の月) */
  maxMonth: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(currentMonth ?? defaultMonth);
  const [status, setStatus] = useState<{ type: "idle" | "saving" | "error"; message?: string }>({ type: "idle" });

  async function save(throughMonth: string | null) {
    if (throughMonth !== null && (throughMonth === "" || throughMonth > maxMonth)) {
      return setStatus({ type: "error", message: "月末を経過した月を選んでください" });
    }
    setStatus({ type: "saving" });
    try {
      const response = await fetch("/api/accounting-confirmation", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ throughMonth }),
      });
      if (!response.ok) {
        return setStatus({
          type: "error",
          message: response.status === 403 ? "権限がありません" : response.status === 400 ? "月末を経過した月を選んでください" : "保存に失敗しました",
        });
      }
      setStatus({ type: "idle" });
      setOpen(false);
      router.refresh();
    } catch {
      setStatus({ type: "error", message: "保存に失敗しました" });
    }
  }

  const buttonClass =
    "rounded border border-[var(--border-hairline)] px-3 py-1 text-xs font-medium text-[var(--text-secondary)] disabled:opacity-50";

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={`self-start ${buttonClass}`}>
        経理確認の対象月を指定
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-end gap-2 rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)] p-3">
      <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
        経理確認済みの最終月（売上・利益の金額はfreeeの値を使います）
        <input
          type="month"
          value={month}
          max={maxMonth}
          onChange={(e) => setMonth(e.target.value)}
          className="rounded border border-[var(--border-hairline)] bg-[var(--surface-1)] px-2 py-1 text-sm text-[var(--text-primary)]"
        />
      </label>
      <button type="button" onClick={() => save(month)} disabled={status.type === "saving"} className={buttonClass}>
        {status.type === "saving" ? "保存中…" : "保存"}
      </button>
      {currentMonth !== null && (
        <button type="button" onClick={() => save(null)} disabled={status.type === "saving"} className={buttonClass}>
          指定を外す（仕掛品振替の判定に戻す）
        </button>
      )}
      <button type="button" onClick={() => setOpen(false)} className={buttonClass}>
        閉じる
      </button>
      {status.message && <span className="text-xs text-[var(--status-serious)]">{status.message}</span>}
    </div>
  );
}
