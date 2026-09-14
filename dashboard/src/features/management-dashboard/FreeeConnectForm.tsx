"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface FreeeConnectFormProps {
  authorizeUrl: string;
}

/**
 * freeeのOOB(urn:ietf:wg:oauth:2.0:oob)認可フロー用フォーム。
 * 自動リダイレクトではなく、freeeの認可画面に表示されたコードをユーザーが
 * 手動で貼り付ける方式(既存の社内freee連携アプリと同じ、redirect_uri登録不要のため)。
 */
export function FreeeConnectForm({ authorizeUrl }: FreeeConnectFormProps) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");

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
