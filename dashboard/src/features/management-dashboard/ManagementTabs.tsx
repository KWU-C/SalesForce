"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";

export type ManagementTabId = "overview" | "performance" | "finance" | "cashflow";

export interface ManagementTab {
  id: ManagementTabId;
  label: string;
  /** サーバーで組み立て済みの表示。ここではデータ取得・計算をしない */
  content: React.ReactNode;
}

const TabSelectContext = createContext<((id: ManagementTabId) => void) | null>(null);

function tabDomId(id: ManagementTabId): string {
  return `management-tab-${id}`;
}

function panelDomId(id: ManagementTabId): string {
  return `management-panel-${id}`;
}

/**
 * 経営画面の4タブ(概要/業績・採算/財務・資金繰り/入出金明細、2026-11-13)。
 * 取得済みのデータの表示を切り替えるだけで、タブ操作でfreee APIの呼び出しや更新処理は行わない。
 *
 * パネルは初めて開いたときにマウントし、以後は hidden で隠して保持する(開閉状態・「すべて表示」を保つ)。
 * 最初から隠した状態でマウントすると、グラフ(ResponsiveContainer)が幅0で描かれるため。
 * キーボード操作はWAI-ARIAのタブの作法(←→・Home・End で移動と同時に切り替え)。
 */
export function ManagementTabs({ tabs, initial = "overview" }: { tabs: ManagementTab[]; initial?: ManagementTabId }) {
  const [active, setActive] = useState<ManagementTabId>(initial);
  const [mounted, setMounted] = useState<Set<ManagementTabId>>(() => new Set([initial]));
  const tabRefs = useRef(new Map<ManagementTabId, HTMLButtonElement>());
  const tabListRef = useRef<HTMLDivElement>(null);

  const select = useCallback((id: ManagementTabId, focus = false) => {
    setActive(id);
    setMounted((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
    if (focus) tabRefs.current.get(id)?.focus();
  }, []);

  // 概要の「〜を見る」から切り替えたときは、タブ列を画面内に戻し、選んだタブへフォーカスを移す
  const selectFromLink = useCallback(
    (id: ManagementTabId) => {
      select(id);
      tabListRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
      tabRefs.current.get(id)?.focus({ preventScroll: true });
    },
    [select]
  );

  function onKeyDown(e: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number | null = null;
    if (e.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    if (next === null) return;
    e.preventDefault();
    select(tabs[next].id, true);
  }

  return (
    <TabSelectContext.Provider value={selectFromLink}>
      <div className="flex flex-col gap-6">
        {/* 狭い幅ではタブ列だけ横スクロールする(文字は潰さない) */}
        <div
          ref={tabListRef}
          role="tablist"
          aria-label="経営ダッシュボードの表示"
          className="-mx-4 flex scroll-mt-4 overflow-x-auto border-b border-[var(--border-hairline)] px-4 sm:mx-0 sm:px-0"
        >
          {tabs.map((tab, index) => {
            const selected = tab.id === active;
            return (
              <button
                key={tab.id}
                ref={(el) => {
                  if (el) tabRefs.current.set(tab.id, el);
                  else tabRefs.current.delete(tab.id);
                }}
                type="button"
                role="tab"
                id={tabDomId(tab.id)}
                aria-selected={selected}
                aria-controls={panelDomId(tab.id)}
                tabIndex={selected ? 0 : -1}
                onClick={() => select(tab.id)}
                onKeyDown={(e) => onKeyDown(e, index)}
                className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium outline-none focus-visible:rounded-t-md focus-visible:ring-2 focus-visible:ring-[var(--series-1)] focus-visible:ring-inset ${
                  selected
                    ? "border-[var(--series-1)] text-[var(--text-primary)]"
                    : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {tabs.map((tab) => (
          <div
            key={tab.id}
            role="tabpanel"
            id={panelDomId(tab.id)}
            aria-labelledby={tabDomId(tab.id)}
            hidden={tab.id !== active}
            tabIndex={0}
            className="flex min-w-0 flex-col gap-8 outline-none focus-visible:ring-2 focus-visible:ring-[var(--series-1)] focus-visible:ring-offset-4"
          >
            {mounted.has(tab.id) ? tab.content : null}
          </div>
        ))}
      </div>
    </TabSelectContext.Provider>
  );
}

/** 概要から各タブへ切り替えるボタン(「業績・採算を見る」など) */
export function ManagementTabLink({ tab, children }: { tab: ManagementTabId; children: React.ReactNode }) {
  const selectTab = useContext(TabSelectContext);
  if (!selectTab) return null;
  return (
    <button
      type="button"
      aria-controls={panelDomId(tab)}
      onClick={() => selectTab(tab)}
      className="inline-flex items-center gap-1 self-start rounded-md text-sm font-medium text-[var(--series-1)] hover:underline focus-visible:ring-2 focus-visible:ring-[var(--series-1)] focus-visible:outline-none"
    >
      {children}
      <span aria-hidden="true">→</span>
    </button>
  );
}
