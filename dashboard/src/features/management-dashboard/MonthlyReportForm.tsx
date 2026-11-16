"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ALLOWED_OVERWRITE_TYPES, CHANGE_TYPE_LABELS, targetMonthLabel } from "./accountingReports";
import type { ChangeType, MonthlyReport } from "./accountingReports";

type FieldType = "amount" | "date" | "text" | "longText";

interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  /** 新しい月を選んだとき、直前の報告の値を初期値に引き継ぐ(目標は毎月同じことが多いため) */
  carryOver?: boolean;
}

const FIELDS: FieldDef[] = [
  { key: "documentName", label: "資料名", type: "text", required: true },
  { key: "basisDate", label: "集計基準日（例: 9月30日現在 → 2026-09-30。記載が無ければ空欄）", type: "date" },
  { key: "revenueCumulative", label: "売上高累計（円）", type: "amount" },
  { key: "prevYearRevenueCumulative", label: "前期売上高累計（円）", type: "amount" },
  { key: "monthlyRevenueTarget", label: "月次目標（円、資料の額。例: 5,333万 → 53330000）", type: "amount", carryOver: true },
  { key: "annualRevenueTarget", label: "通期目標（円）", type: "amount", carryOver: true },
  { key: "ordinaryProfitCumulative", label: "経常利益累計（円、マイナスは-または▲）", type: "amount" },
  { key: "prevYearOrdinaryProfitCumulative", label: "前期同月 経常利益累計（円）", type: "amount" },
  { key: "operatingProfitCumulative", label: "営業利益累計（円）", type: "amount" },
  { key: "reportDate", label: "資料の報告日（記載が無ければ空欄）", type: "date" },
  { key: "cashWatchItems", label: "資金繰り 注視事項（1行1項目。例: 11月：労働保険129万8,280）", type: "longText" },
  { key: "differenceExplanation", label: "freeeとの差額の説明（未確認なら空欄）", type: "longText" },
  { key: "note", label: "メモ", type: "longText" },
];

/** 金額入力: 桁区切り・全角・▲(マイナス)を受け付ける。空欄はnull、読めなければ"invalid" */
export function parseAmountInput(text: string): number | null | "invalid" {
  const normalized = text
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[,，\s円]/g, "")
    .replace(/^[▲△－−]/, "-");
  if (normalized === "") return null;
  if (!/^-?\d+$/.test(normalized)) return "invalid";
  return Number(normalized);
}

function toInputs(values: Record<string, unknown> | null, carryFrom: Record<string, unknown> | null): Record<string, string> {
  const result: Record<string, string> = {};
  for (const f of FIELDS) {
    const v = values ? values[f.key] : f.carryOver ? carryFrom?.[f.key] : null;
    result[f.key] = v === null || v === undefined ? "" : f.type === "amount" ? Number(v).toLocaleString("ja-JP") : String(v);
  }
  return result;
}

/**
 * 経理月次報告(経理報告PDF)の登録・訂正フォーム(2026-11-16、概要の経理報告の再現のため復活)。経営タブ自体が
 * 閲覧許可リストの人にしか表示されず、保存API側でもIAP検証と許可リストを確認する。登録済みの月への保存は
 * 理由(訂正/メモ更新)を選ばせ、上書き前の値は履歴に残る(削除の操作は無い)。
 */
export function MonthlyReportForm({ reports, defaultMonth }: { reports: MonthlyReport[]; defaultMonth: string }) {
  const router = useRouter();
  const latest = [...reports].sort((a, b) => b.targetMonth.localeCompare(a.targetMonth))[0] ?? null;
  const carryFrom = (latest?.values as unknown as Record<string, unknown>) ?? null;
  const find = (month: string) => reports.find((r) => r.targetMonth === month) ?? null;

  const [open, setOpen] = useState(false);
  const [targetMonth, setTargetMonth] = useState(defaultMonth);
  const [inputs, setInputs] = useState<Record<string, string>>(() =>
    toInputs((find(defaultMonth)?.values as unknown as Record<string, unknown>) ?? null, carryFrom)
  );
  const [changeType, setChangeType] = useState<ChangeType | "">("");
  const [status, setStatus] = useState<{ type: "idle" | "saving" | "saved" | "error"; message?: string }>({ type: "idle" });

  const existing = find(targetMonth);
  const overwriteTypes = ALLOWED_OVERWRITE_TYPES["monthly-report"];

  function selectMonth(month: string) {
    setTargetMonth(month);
    setInputs(toInputs((find(month)?.values as unknown as Record<string, unknown>) ?? null, carryFrom));
    setChangeType("");
    setStatus({ type: "idle" });
  }

  function buildValues(): Record<string, unknown> | string {
    const values: Record<string, unknown> = {};
    for (const f of FIELDS) {
      const text = inputs[f.key] ?? "";
      if (f.type === "amount") {
        const parsed = parseAmountInput(text);
        if (parsed === "invalid") return `${f.label}は整数で入力してください`;
        values[f.key] = parsed;
      } else {
        values[f.key] = text.trim() === "" ? null : text.trim();
      }
      if (f.required && values[f.key] === null) return `${f.label}は必須です`;
    }
    return values;
  }

  async function handleSave() {
    const values = buildValues();
    if (!targetMonth) return setStatus({ type: "error", message: "対象月を選んでください" });
    if (typeof values === "string") return setStatus({ type: "error", message: values });
    if (existing && !changeType) return setStatus({ type: "error", message: "登録済みの月です。上書きの理由を選んでください" });
    setStatus({ type: "saving" });
    try {
      const response = await fetch(`/api/accounting-reports/monthly-report/${targetMonth}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values, ...(existing ? { changeType } : {}) }),
      });
      if (!response.ok) {
        const reason =
          response.status === 403
            ? "権限がありません"
            : response.status === 409
              ? "他の人が先に登録しました。画面を再読み込みしてから訂正してください"
              : response.status === 400
                ? changeType === "noteUpdate"
                  ? "メモ更新ではメモ以外の項目を変更できません。数値などを直す場合は「訂正」を選んでください"
                  : "入力内容を確認してください（金額が1つも無い登録はできません）"
                : "保存に失敗しました";
        return setStatus({ type: "error", message: reason });
      }
      setStatus({ type: "saved", message: `${targetMonthLabel(targetMonth)}を保存しました` });
      router.refresh();
    } catch {
      setStatus({ type: "error", message: "保存に失敗しました" });
    }
  }

  const inputClass =
    "w-full min-w-0 rounded border border-[var(--border-hairline)] bg-[var(--surface-1)] px-2 py-1 text-sm text-[var(--text-primary)]";

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-start rounded border border-[var(--border-hairline)] px-3 py-1 text-sm font-medium text-[var(--text-secondary)]"
      >
        経理報告を登録・訂正
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)] p-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
          対象月（報告の最終月）
          <input type="month" value={targetMonth} onChange={(e) => selectMonth(e.target.value)} className={inputClass} />
        </label>
        {targetMonth && (
          <span className="pb-1 text-xs text-[var(--text-muted)]">
            {targetMonthLabel(targetMonth)}：
            {existing ? "登録済み（保存すると上書きし、前の値は履歴に残ります）" : "未登録（初回登録。目標は直前の報告から引き継いでいます）"}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <label
            key={f.key}
            className={`flex min-w-0 flex-col gap-1 text-xs text-[var(--text-secondary)] ${f.type === "longText" ? "sm:col-span-2" : ""}`}
          >
            {f.label}
            {f.type === "longText" ? (
              <textarea
                rows={f.key === "cashWatchItems" ? 5 : 2}
                value={inputs[f.key] ?? ""}
                onChange={(e) => setInputs({ ...inputs, [f.key]: e.target.value })}
                className={`${inputClass} resize-y`}
              />
            ) : (
              <input
                type={f.type === "date" ? "date" : "text"}
                inputMode={f.type === "amount" ? "numeric" : undefined}
                value={inputs[f.key] ?? ""}
                onChange={(e) => setInputs({ ...inputs, [f.key]: e.target.value })}
                className={`${inputClass} ${f.type === "amount" ? "text-right tabular-nums" : ""}`}
              />
            )}
          </label>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        {existing ? (
          <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--text-secondary)]">
            上書きの理由:
            {overwriteTypes.map((t) => (
              <label key={t} className="flex items-center gap-1">
                <input type="radio" name="changeType" checked={changeType === t} onChange={() => setChangeType(t)} />
                {CHANGE_TYPE_LABELS[t]}
              </label>
            ))}
          </div>
        ) : (
          <span />
        )}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {status.message && (
            <span className={status.type === "error" ? "text-[var(--status-serious)]" : "text-[var(--text-muted)]"}>{status.message}</span>
          )}
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded border border-[var(--border-hairline)] px-3 py-1 font-medium text-[var(--text-secondary)]"
          >
            閉じる
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={status.type === "saving"}
            className="rounded border border-[var(--border-hairline)] px-3 py-1 font-medium text-[var(--text-primary)] disabled:opacity-50"
          >
            {status.type === "saving" ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
