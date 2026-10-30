"use client";

import { useState } from "react";
import { formatDateTime, formatYen } from "@/utils/format";
import type { FocusClientMaster, FocusClientSavedFields } from "./focusClients";

type TextField = "strategy" | "currentStatus" | "monthAction" | "nextAction";

/** 表示順・ラベル。営業戦略は比較的固定、現在の状況以下は月次で更新する想定(ユーザー確定、2026-10-15) */
const TEXT_FIELDS: { key: TextField; label: string; rows: number }[] = [
  { key: "strategy", label: "営業戦略", rows: 3 },
  { key: "currentStatus", label: "現在の状況", rows: 3 },
  { key: "monthAction", label: "今月のアクション", rows: 2 },
  { key: "nextAction", label: "次回アクション", rows: 2 },
];

function amountText(amount: number | null): string {
  return amount === null ? "未入力" : formatYen(amount);
}

interface FocusClientEditorProps {
  master: FocusClientMaster;
  term: number;
  onSaved: (saved: FocusClientSavedFields) => void;
}

/**
 * 注力クライアント1社分の詳細。区分・担当・テーマ・目標はSalesforce取引先の値を表示するだけで、
 * 営業戦略・状況・アクションをここで編集する(ユーザー確定、2026-10-30)。保存はCloud Run上のAPIルート
 * (/api/focus-clients/[accountId])経由のみ(ブラウザからFirestoreへ直接アクセスしない)。
 */
export function FocusClientEditor({ master, term, onSaved }: FocusClientEditorProps) {
  const target = master.targets[String(term)] ?? { sales: null, grossProfit: null };
  const [texts, setTexts] = useState<Record<TextField, string>>(() => ({
    strategy: master.strategy,
    currentStatus: master.currentStatus,
    monthAction: master.monthAction,
    nextAction: master.nextAction,
  }));
  const [status, setStatus] = useState<"idle" | "saving" | "error" | "saved">("idle");

  const changedFields = TEXT_FIELDS.filter(({ key }) => texts[key] !== master[key]).map(({ key }) => key);
  const isDirty = changedFields.length > 0;

  async function handleSave() {
    setStatus("saving");
    try {
      const response = await fetch(`/api/focus-clients/${encodeURIComponent(master.accountId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields: Object.fromEntries(changedFields.map((key) => [key, texts[key]])) }),
      });
      if (!response.ok) throw new Error("save failed");
      onSaved((await response.json()) as FocusClientSavedFields);
      setStatus("saved");
    } catch {
      setStatus("error");
    }
  }

  const inputClass =
    "w-full rounded border border-[var(--border-hairline)] bg-[var(--surface-1)] px-2 py-1 text-sm text-[var(--text-primary)]";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr_auto_1fr]">
          <dt className="text-xs text-[var(--text-secondary)]">注力区分</dt>
          <dd className="text-[var(--text-primary)]">{master.category || "未入力"}</dd>
          <dt className="text-xs text-[var(--text-secondary)]">社内担当</dt>
          <dd className="text-[var(--text-primary)]">{master.owner || "未入力"}</dd>
          <dt className="text-xs text-[var(--text-secondary)]">第{term}期 目標売上</dt>
          <dd className="tabular-nums text-[var(--text-primary)]">{amountText(target.sales)}</dd>
          <dt className="text-xs text-[var(--text-secondary)]">第{term}期 目標粗利</dt>
          <dd className="tabular-nums text-[var(--text-primary)]">{amountText(target.grossProfit)}</dd>
          <dt className="text-xs text-[var(--text-secondary)]">注力テーマ</dt>
          <dd className="whitespace-pre-wrap text-[var(--text-primary)] sm:col-span-3">{master.theme || "未入力"}</dd>
        </dl>
        <p className="text-xs text-[var(--text-muted)]">
          区分・担当・目標・テーマはSalesforceの取引先で編集してください（当期の目標は取引先の目標売上・目標粗利、過去の期はダッシュボードに保存していた目標です）。
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {TEXT_FIELDS.map(({ key, label, rows }) => (
          <label key={key} className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
            {label}
            {rows === 1 ? (
              <input value={texts[key]} onChange={(e) => setTexts({ ...texts, [key]: e.target.value })} className={inputClass} />
            ) : (
              <textarea
                value={texts[key]}
                onChange={(e) => setTexts({ ...texts, [key]: e.target.value })}
                rows={rows}
                className={`${inputClass} resize-y`}
              />
            )}
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--text-muted)]">
        <span>
          {master.updatedAt
            ? `最終更新: ${master.updatedBy ?? ""} ${formatDateTime(new Date(master.updatedAt))}`
            : "未編集"}
        </span>
        <div className="flex items-center gap-2">
          {status === "error" && <span className="text-[var(--status-serious)]">保存に失敗しました</span>}
          {status === "saved" && !isDirty && <span>保存しました</span>}
          <button
            type="button"
            onClick={handleSave}
            disabled={!isDirty || status === "saving"}
            className="rounded border border-[var(--border-hairline)] px-3 py-1 font-medium text-[var(--text-secondary)] disabled:opacity-50"
          >
            {status === "saving" ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
