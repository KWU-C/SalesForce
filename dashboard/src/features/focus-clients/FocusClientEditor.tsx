"use client";

import { useState } from "react";
import { formatDateTime } from "@/utils/format";
import type { FocusClientMaster } from "./focusClients";

type TextField = "category" | "theme" | "owner" | "strategy" | "currentStatus" | "monthAction" | "nextAction";

/** 表示順・ラベル。営業戦略は比較的固定、現在の状況以下は月次で更新する想定(ユーザー確定、2026-10-15) */
const TEXT_FIELDS: { key: TextField; label: string; rows: number }[] = [
  { key: "category", label: "注力区分", rows: 1 },
  { key: "owner", label: "社内担当", rows: 1 },
  { key: "theme", label: "注力テーマ", rows: 3 },
  { key: "strategy", label: "営業戦略", rows: 3 },
  { key: "currentStatus", label: "現在の状況", rows: 3 },
  { key: "monthAction", label: "今月のアクション", rows: 2 },
  { key: "nextAction", label: "次回アクション", rows: 2 },
];

/** 目標入力欄は万円単位(表示・入力の桁を減らすため)。保存は円 */
function toManInput(amount: number | null): string {
  return amount === null ? "" : String(amount / 10000);
}

function parseManInput(text: string): number | null | "invalid" {
  const trimmed = text.replace(/,/g, "").trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return "invalid";
  return Math.round(value * 10000);
}

interface FocusClientEditorProps {
  master: FocusClientMaster;
  term: number;
  onSaved: (master: FocusClientMaster) => void;
}

/**
 * 注力クライアントマスタ1社分の編集フォーム。保存はCloud Run上のAPIルート
 * (/api/focus-clients/[accountId])経由のみ(ブラウザからFirestoreへ直接アクセスしない)。
 */
export function FocusClientEditor({ master, term, onSaved }: FocusClientEditorProps) {
  const target = master.targets[String(term)] ?? { sales: null, grossProfit: null };
  const [texts, setTexts] = useState<Record<TextField, string>>(() => ({
    category: master.category,
    theme: master.theme,
    owner: master.owner,
    strategy: master.strategy,
    currentStatus: master.currentStatus,
    monthAction: master.monthAction,
    nextAction: master.nextAction,
  }));
  const [salesText, setSalesText] = useState(toManInput(target.sales));
  const [grossProfitText, setGrossProfitText] = useState(toManInput(target.grossProfit));
  const [status, setStatus] = useState<"idle" | "saving" | "error" | "invalid" | "saved">("idle");

  const changedFields = TEXT_FIELDS.filter(({ key }) => texts[key] !== master[key]).map(({ key }) => key);
  const sales = parseManInput(salesText);
  const grossProfit = parseManInput(grossProfitText);
  const targetChanged = sales !== target.sales || grossProfit !== target.grossProfit;
  const isDirty = changedFields.length > 0 || targetChanged;

  async function handleSave() {
    if (sales === "invalid" || grossProfit === "invalid") {
      setStatus("invalid");
      return;
    }
    setStatus("saving");
    try {
      const body: Record<string, unknown> = {};
      if (changedFields.length > 0) {
        body.fields = Object.fromEntries(changedFields.map((key) => [key, texts[key]]));
      }
      if (targetChanged) body.target = { term, sales, grossProfit };
      const response = await fetch(`/api/focus-clients/${encodeURIComponent(master.accountId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error("save failed");
      const saved = (await response.json()) as FocusClientMaster;
      onSaved(saved);
      setStatus("saved");
    } catch {
      setStatus("error");
    }
  }

  const inputClass =
    "w-full rounded border border-[var(--border-hairline)] bg-[var(--surface-1)] px-2 py-1 text-sm text-[var(--text-primary)]";

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
          第{term}期 目標売上（万円）
          <input
            inputMode="decimal"
            value={salesText}
            onChange={(e) => setSalesText(e.target.value)}
            placeholder="未入力"
            className={`${inputClass} text-right tabular-nums`}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
          第{term}期 目標粗利（万円）
          <input
            inputMode="decimal"
            value={grossProfitText}
            onChange={(e) => setGrossProfitText(e.target.value)}
            placeholder="未入力"
            className={`${inputClass} text-right tabular-nums`}
          />
        </label>
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
            : "初期データ（Salesforceの取引先から投入）"}
        </span>
        <div className="flex items-center gap-2">
          {status === "error" && <span className="text-[var(--status-serious)]">保存に失敗しました</span>}
          {status === "invalid" && <span className="text-[var(--status-serious)]">目標は0以上の数値で入力してください</span>}
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
