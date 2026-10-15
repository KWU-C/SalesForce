"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ALLOWED_OVERWRITE_TYPES, CHANGE_TYPE_LABELS, checkCashPlan, targetMonthLabel } from "./accountingReports";
import type { AccountingReportKind, CashPlan, ChangeType, MonthlyReport } from "./accountingReports";

type FieldType = "amount" | "date" | "text" | "longText";

interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
}

const MONTHLY_REPORT_FIELDS: FieldDef[] = [
  { key: "documentName", label: "資料名", type: "text", required: true },
  { key: "basisDate", label: "集計基準日（資料に記載が無ければ空欄）", type: "date" },
  { key: "reportDate", label: "資料の報告日（資料に記載が無ければ空欄）", type: "date" },
  { key: "revenueCumulative", label: "売上高累計（円）", type: "amount" },
  { key: "ordinaryProfitCumulative", label: "経常利益累計（円、マイナスは-または▲）", type: "amount" },
  { key: "prevYearRevenueCumulative", label: "前期同月 売上高累計（任意）", type: "amount" },
  { key: "prevYearOrdinaryProfitCumulative", label: "前期同月 経常利益累計（任意）", type: "amount" },
  { key: "differenceExplanation", label: "freeeとの差額の説明（未確認なら空欄）", type: "longText" },
  { key: "note", label: "メモ", type: "longText" },
];

const CASH_PLAN_FIELDS: FieldDef[] = [
  { key: "documentName", label: "資料名", type: "text", required: true },
  { key: "sourceUpdatedOn", label: "資料の更新日（記載が無ければ空欄）", type: "date" },
  { key: "checkingSavingsTotal", label: "当座・普通預金合計", type: "amount" },
  { key: "timeDepositTotal", label: "定期預金月末予定残高（月中の積立を反映）", type: "amount" },
  { key: "collateralDeduction", label: "担保控除額（経理）", type: "amount" },
  { key: "depositTotalAfterCollateral", label: "預金総合計（担保控除後）", type: "amount" },
  { key: "consumptionTaxReserve", label: "消費税引当", type: "amount" },
  { key: "bonusReserve", label: "賞与引当", type: "amount" },
  { key: "checkingSavingsAfterReserves", label: "引当控除後の当座・普通預金合計", type: "amount" },
  { key: "depositTotalAfterReserves", label: "引当控除後の預金総合計", type: "amount" },
  { key: "note", label: "メモ", type: "longText" },
];

const FIELDS: Record<AccountingReportKind, FieldDef[]> = {
  "monthly-report": MONTHLY_REPORT_FIELDS,
  "cash-plan": CASH_PLAN_FIELDS,
};

const KIND_LABELS: Record<AccountingReportKind, string> = {
  "monthly-report": "経理月次報告（実績）",
  "cash-plan": "資金繰り予定（月末予定）",
};

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

function toInputs(fields: FieldDef[], values: Record<string, unknown> | null): Record<string, string> {
  const result: Record<string, string> = {};
  for (const f of fields) {
    const v = values?.[f.key];
    result[f.key] = v === null || v === undefined ? "" : f.type === "amount" ? Number(v).toLocaleString("ja-JP") : String(v);
  }
  return result;
}

interface AccountingReportFormProps {
  monthlyReports: MonthlyReport[];
  cashPlans: CashPlan[];
}

/**
 * 経理月次報告・資金繰り予定の登録・訂正フォーム。経営タブ自体が閲覧許可リストの人にしか
 * 表示されず、保存API側でもIAP検証と許可リストを確認する。既存の値がある月への保存は、
 * 理由(訂正/予測更新)を選ばせ、上書き前の値は履歴に残る(削除の操作は無い)。
 */
export function AccountingReportForm({ monthlyReports, cashPlans }: AccountingReportFormProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<AccountingReportKind>("monthly-report");
  const [targetMonth, setTargetMonth] = useState("");
  const [inputs, setInputs] = useState<Record<string, string>>(() => toInputs(MONTHLY_REPORT_FIELDS, null));
  const [changeType, setChangeType] = useState<ChangeType | "">("");
  const [status, setStatus] = useState<{ type: "idle" | "saving" | "saved" | "error"; message?: string }>({ type: "idle" });

  const fields = FIELDS[kind];
  const existingList: (MonthlyReport | CashPlan)[] = kind === "monthly-report" ? monthlyReports : cashPlans;
  const existing = existingList.find((r) => r.targetMonth === targetMonth) ?? null;
  const overwriteTypes = ALLOWED_OVERWRITE_TYPES[kind];

  function load(nextKind: AccountingReportKind, nextMonth: string) {
    const list: (MonthlyReport | CashPlan)[] = nextKind === "monthly-report" ? monthlyReports : cashPlans;
    const found = list.find((r) => r.targetMonth === nextMonth) ?? null;
    setInputs(toInputs(FIELDS[nextKind], (found?.values as unknown as Record<string, unknown>) ?? null));
    setChangeType("");
    setStatus({ type: "idle" });
  }

  function buildValues(): Record<string, unknown> | string {
    const values: Record<string, unknown> = {};
    for (const f of fields) {
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

  const preview = buildValues();
  const cashPlanWarnings =
    kind === "cash-plan" && typeof preview !== "string"
      ? checkCashPlan(preview as never).filter((c) => c.difference !== null && c.difference !== 0)
      : [];

  async function handleSave() {
    if (!targetMonth) return setStatus({ type: "error", message: "対象月を選んでください" });
    if (typeof preview === "string") return setStatus({ type: "error", message: preview });
    if (existing && !changeType) return setStatus({ type: "error", message: "既存の値があります。訂正か予測更新かを選んでください" });
    setStatus({ type: "saving" });
    try {
      const response = await fetch(`/api/accounting-reports/${kind}/${targetMonth}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values: preview, ...(existing ? { changeType } : {}) }),
      });
      if (!response.ok) {
        const reason =
          response.status === 403
            ? "権限がありません"
            : response.status === 409
              ? "他の人が先に登録しました。画面を再読み込みしてから訂正してください"
              : response.status === 400
                ? "入力内容を確認してください"
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
    "w-full rounded border border-[var(--border-hairline)] bg-[var(--surface-1)] px-2 py-1 text-sm text-[var(--text-primary)]";

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-start rounded border border-[var(--border-hairline)] px-3 py-1 text-sm font-medium text-[var(--text-secondary)]"
      >
        登録・訂正
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)] p-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
          種類
          <select
            value={kind}
            onChange={(e) => {
              const next = e.target.value as AccountingReportKind;
              setKind(next);
              load(next, targetMonth);
            }}
            className={inputClass}
          >
            {(Object.keys(KIND_LABELS) as AccountingReportKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
          {kind === "monthly-report" ? "対象月" : "対象月末"}
          <input
            type="month"
            value={targetMonth}
            onChange={(e) => {
              setTargetMonth(e.target.value);
              load(kind, e.target.value);
            }}
            className={inputClass}
          />
        </label>
        {targetMonth && (
          <span className="pb-1 text-xs text-[var(--text-muted)]">
            {targetMonthLabel(targetMonth)}：{existing ? "登録済み（保存すると上書きし、前の値は履歴に残ります）" : "未登録（初回登録）"}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {fields.map((f) => (
          <label key={f.key} className={`flex flex-col gap-1 text-xs text-[var(--text-secondary)] ${f.type === "longText" ? "sm:col-span-2" : ""}`}>
            {f.label}
            {f.type === "longText" ? (
              <textarea
                rows={2}
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

      {cashPlanWarnings.map((c) => (
        <p key={c.label} className="text-xs font-medium text-[var(--status-serious)]">
          資料内の検算が合いません: {c.label}（差 {c.difference?.toLocaleString("ja-JP")}円）。資料の数値のまま保存できます。
        </p>
      ))}

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
        <div className="flex items-center gap-2 text-xs">
          {status.message && (
            <span className={status.type === "error" ? "text-[var(--status-serious)]" : "text-[var(--text-muted)]"}>
              {status.message}
            </span>
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
