"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

/** ページ(Server Component)を再実行してデータを再取得するボタン */
export function RefreshButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isHovered, setIsHovered] = useState(false);

  return (
    <button
      type="button"
      onClick={() => startTransition(() => router.refresh())}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      disabled={isPending}
      className="rounded border border-[var(--border-hairline)] px-2 py-1 text-xs text-[var(--text-secondary)] transition-colors disabled:opacity-60"
      style={{ backgroundColor: isHovered ? "var(--gridline)" : undefined }}
    >
      {isPending ? "更新中…" : "更新"}
    </button>
  );
}
