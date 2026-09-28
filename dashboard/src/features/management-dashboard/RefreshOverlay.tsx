"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/** 経営タブの読み込み表示(スピナー＋文言)。app/management/loading.tsx と更新中の重ね表示で共用する */
export function FreeeLoadingIndicator() {
  return (
    <>
      <div
        role="status"
        aria-label="読み込み中"
        className="h-10 w-10 animate-spin rounded-full border-4 border-[var(--text-primary)]/30 border-t-[var(--text-primary)]"
      />
      <p className="text-sm text-[var(--text-secondary)]">freeeから読み込んでいます...</p>
    </>
  );
}

interface RefreshOverlayContextValue {
  /** 重ね表示を開始し、終了する関数を返す(複数のボタンが同時に更新しても、全て終わるまで表示する) */
  begin: () => () => void;
}

const RefreshOverlayContext = createContext<RefreshOverlayContextValue>({ begin: () => () => {} });

/**
 * 「更新」系ボタン(freeeから再取得→router.refresh)の実行中、本文領域にloading.tsxと同じ読み込み表示を
 * 重ねる(ユーザー確定、2026-09-28)。router.refresh()ではloading.tsxが表示されない(古い画面のまま
 * 裏で再描画する)ため、ここで明示的に表示する。layout.tsxでナビの下の本文だけを包み、ナビは覆わない
 * (loading.tsxと同じ方針、2026-09-16)。長いページの途中のボタンでも見えるよう、表示はsticky。
 */
export function RefreshOverlayProvider({ children }: { children: React.ReactNode }) {
  const [activeCount, setActiveCount] = useState(0);
  const begin = useCallback(() => {
    setActiveCount((n) => n + 1);
    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      setActiveCount((n) => n - 1);
    };
  }, []);
  const value = useMemo(() => ({ begin }), [begin]);

  return (
    <RefreshOverlayContext.Provider value={value}>
      <div className="relative flex flex-1 flex-col">
        {children}
        {activeCount > 0 && (
          <div className="absolute inset-0 z-40 bg-black/20" aria-busy="true">
            <div className="sticky top-0 flex flex-col items-center gap-3 pt-16">
              <FreeeLoadingIndicator />
            </div>
          </div>
        )}
      </div>
    </RefreshOverlayContext.Provider>
  );
}

/**
 * freeeからの再取得APIを呼び、成功したら画面を再描画する。APIの応答待ちから再描画の完了まで
 * (router.refreshをTransitionで包み、isPendingで完了を検知する)読み込み表示を重ねる。
 */
export function useFreeeRefresh(url: string, body: unknown) {
  const router = useRouter();
  const { begin } = useContext(RefreshOverlayContext);
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<"idle" | "refreshing" | "error">("idle");
  const busy = status === "refreshing" || isPending;

  useEffect(() => {
    if (!busy) return;
    return begin();
  }, [busy, begin]);

  async function refresh() {
    setStatus("refreshing");
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setStatus("error");
        return;
      }
      startTransition(() => {
        setStatus("idle");
        router.refresh();
      });
    } catch {
      setStatus("error");
    }
  }

  return { status, busy, refresh };
}
