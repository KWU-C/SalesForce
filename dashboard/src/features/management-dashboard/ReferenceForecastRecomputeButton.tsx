"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * 参考予測の再計算ボタン(DEVのみ、2026-11-18)。freee・Salesforceの最新データで計算し、新しい記録として追加する
 * (過去の記録は残す)。計算には1分前後かかる。保存API側でもIAP検証・許可リスト・DEVのデータベースかを確認する。
 */
export function ReferenceForecastRecomputeButton() {
  const router = useRouter();
  const [status, setStatus] = useState<{ type: "idle" | "running" | "done" | "error"; message?: string }>({ type: "idle" });

  async function run() {
    setStatus({ type: "running" });
    try {
      const response = await fetch("/api/reference-forecast/recompute", { method: "POST" });
      const body = (await response.json().catch(() => ({}))) as { id?: string; message?: string; warnings?: string[] };
      if (!response.ok) {
        return setStatus({
          type: "error",
          message: response.status === 403 ? "権限がありません" : response.status === 409 ? (body.message ?? "直前に計算済みです") : `再計算に失敗しました（${body.message ?? response.status}）`,
        });
      }
      setStatus({ type: "done", message: `記録 ${body.id} を追加しました${body.warnings && body.warnings.length > 0 ? `（要確認 ${body.warnings.length}件：注記を参照）` : ""}` });
      router.refresh();
    } catch {
      setStatus({ type: "error", message: "再計算に失敗しました" });
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={run}
        disabled={status.type === "running"}
        className="rounded border border-[var(--border-hairline)] px-3 py-1 text-xs font-medium text-[var(--text-secondary)] disabled:opacity-50"
      >
        {status.type === "running" ? "再計算中…（1分前後）" : "freee・Salesforceの最新データで再計算"}
      </button>
      {status.message && (
        <span role="status" className={`text-xs ${status.type === "error" ? "text-[var(--status-critical)]" : "text-[var(--text-muted)]"}`}>
          {status.message}
        </span>
      )}
    </div>
  );
}
