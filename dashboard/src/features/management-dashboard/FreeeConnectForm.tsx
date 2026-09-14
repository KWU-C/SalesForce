"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface FreeeConnectFormProps {
  authorizeUrl: string;
  /**
   * "connect": 未接続時の初回接続フォーム(常に表示)。
   * "reconnect": 接続済みだが、freeeアプリの権限変更後などに再接続が必要な場合用。
   * 通常時に画面を圧迫しないよう、リンクをクリックするまでフォームを畳んでおく
   * (ユーザー報告のバグ対応: 接続済み表示のままだと再接続する手段が無かった、2026-09-14)。
   */
  mode?: "connect" | "reconnect";
}

export function FreeeConnectForm({ authorizeUrl, mode = "connect" }: FreeeConnectFormProps) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [expanded, setExpanded] = useState(mode === "connect");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    setStatus("submitting");
    try {
      const res = await fetch("/api/freee/oauth/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      if (!res.ok) {
        setStatus("error");
        return;
      }
      setCode("");
      setStatus("idle");
      router.refresh();
    } catch {
      setStatus("error");
    }
  }

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="self-start text-xs text-[var(--text-muted)] underline"
      >
        freeeの権限設定を変更した場合は、ここから再接続
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg bg-[var(--surface-sunken)] p-4">
      <p className="text-sm text-[var(--text-secondary)]">
        1.{" "}
        <a
          href={authorizeUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--series-1)] underline"
        >
          freeeで連携を許可する
        </a>{" "}
        → 画面に表示された認可コードを下に貼り付けて送信してください。
      </p>
      <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="認可コードを貼り付け"
          className="min-w-64 flex-1 rounded border border-[var(--border-hairline)] px-2 py-1 text-sm"
        />
        <button
          type="submit"
          disabled={status === "submitting" || !code.trim()}
          className="rounded bg-[var(--series-1)] px-3 py-1 text-sm font-medium text-white disabled:opacity-50"
        >
          接続
        </button>
      </form>
      {status === "error" && (
        <p className="text-sm text-red-600">
          接続に失敗しました。コードが正しいか、期限切れでないか確認してください。
        </p>
      )}
    </div>
  );
}
