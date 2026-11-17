/**
 * 資金・損益の参考予測(DEVのみ、2026-11-17)。
 *
 * 計算はローカルの scripts/reference-forecast(freee・Salesforceの取得データから日別の出来事を積み上げる)で行い、
 * 結果の集計だけを referenceForecasts に1件ずつ追加保存する(既存の記録は上書きしない)。画面は最新の1件を表示するだけで、
 * ここでは計算しない。取引先名・個人名・口座番号は持たない。
 *
 * 表示の方針(ユーザー確定、2026-11-17):
 * - 資金は標準・慎重・年末入金が翌年へずれるケース。ケースの違いは条件の比較で、予測誤差の範囲ではない
 * - 損益のA〜Cは「仮定別の参考試算」で、予測の上限・下限として扱わない
 * - 主表示は万円単位。根拠・推計・限界は詳細欄にまとめる
 * - PDFの数値は計算に使わない。本番には出さない(本番のデータベースでは読み書きしない)
 */
import { PRODUCTION_DATABASE_ID, resolveFirestoreDatabaseId } from "@/services/firestore/databaseId";

export const REFERENCE_FORECAST_SCHEMA_VERSION = 1;

export interface ReferenceCashMonth {
  month: string;
  start: number;
  end: number;
  minEndOfDay: { date: string | null; amount: number };
  /** 同じ日に出金が入金より先に起きた場合の最低(参考) */
  minIntraday: number;
  byBasis: Record<string, number>;
  byCategory: Record<string, number>;
}

export interface ReferenceCashCase {
  id: string;
  label: string;
  months: ReferenceCashMonth[];
}

export interface ReferencePlMonth {
  month: string;
  revenue: number;
  grossProfit: number;
  ordinaryProfit: number;
  wipChange: number | null;
  basis: string;
}

export interface ReferencePlScenario {
  id: string;
  label: string;
  months: ReferencePlMonth[];
  cumulative: { revenue: number; ordinaryProfit: number };
}

export interface ReferenceForecastRecord {
  schemaVersion: number;
  id: string;
  baseDate: string;
  createdAt: string;
  createdBy: string;
  codeCommit: string;
  dataFetchedAt: { freee: string; salesforce: string };
  cash: {
    startBalance: number;
    startTimeDeposit: number;
    startCash: number;
    cases: ReferenceCashCase[];
    dec31Receipts: { sfAdded: number; sfAddedStandardKinds: number; freeeUnsettled: number };
    checks: {
      ownTransfers: Record<string, number>;
      excludedFromBulk: { case: string; month: string; class: string; amount: number }[];
      bulkReference: { date: string; bulk: number; byClass: Record<string, number>; bulkClassesTotal: number }[];
      payrollDecember: { count: number; fixed: number; transfer: number; expense: number; calculatedAt: string; workedZero: number } | null;
    };
  };
  matching: {
    byClass: { label: string; count: number; amount: number }[];
    ambiguous: { class: string; reason: string; count: number; amount: number }[];
    freeeUnmatchedUnsettled: { count: number; amount: number };
  };
  pl: { scenarios: ReferencePlScenario[] };
  notes: { basis: string[]; estimates: string[]; limits: string[] };
}

/** 主表示に出す資金のケース(順序どおり)。それ以外のケースは詳細欄に出す */
export const MAIN_CASH_CASE_IDS = ["standard", "cautious", "yearEndSlip"] as const;

/** 参考予測は本番のデータベースでは扱わない(読み書きとも)。DEV(dashboard-dev)とローカル試験だけ */
export function isReferenceForecastEnabled(databaseId: string = resolveFirestoreDatabaseId()): boolean {
  return databaseId !== PRODUCTION_DATABASE_ID;
}

/** 保存前の検査。形が崩れた記録・金額でない値・取引先名らしき項目を持つ記録は保存しない */
export function validateReferenceForecastRecord(value: unknown): string[] {
  const errors: string[] = [];
  const r = value as Partial<ReferenceForecastRecord> | null;
  if (!r || typeof r !== "object") return ["記録がオブジェクトではありません"];
  if (r.schemaVersion !== REFERENCE_FORECAST_SCHEMA_VERSION) errors.push("schemaVersion が想定と違います");
  if (typeof r.id !== "string" || !/^\d{4}-\d{2}-\d{2}_\d{8}T\d{6}$/.test(r.id)) errors.push("id の形式が違います(基準日_作成日時)");
  if (typeof r.baseDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(r.baseDate)) errors.push("baseDate の形式が違います");
  if (r.id && r.baseDate && !r.id.startsWith(`${r.baseDate}_`)) errors.push("id が基準日で始まっていません");
  const cases = r.cash?.cases ?? [];
  for (const id of MAIN_CASH_CASE_IDS) {
    if (!cases.some((c) => c.id === id)) errors.push(`資金のケース ${id} がありません`);
  }
  for (const c of cases) {
    for (const m of c.months) {
      if (![m.start, m.end, m.minEndOfDay?.amount, m.minIntraday].every(Number.isFinite)) errors.push(`${c.id} ${m.month} の金額が数値ではありません`);
      const sum = Object.values(m.byBasis).reduce((a, b) => a + b, 0);
      if (sum !== m.end - m.start) errors.push(`${c.id} ${m.month} の根拠別の合計(${sum})が残高の増減(${m.end - m.start})と一致しません`);
    }
  }
  if ((r.pl?.scenarios ?? []).length === 0) errors.push("損益の参考試算がありません");
  const text = JSON.stringify(value);
  if (/"(partner|partnerName|取引先名|employee_name|employee_display_name|account_number)"/.test(text)) errors.push("取引先名・個人名・口座番号らしき項目があります");
  return errors;
}

/** 万円単位(整数、桁区切り)。主表示用。例: 7,973万円 / ▲1,234万円 */
export function formatManYenInt(amount: number): string {
  const man = Math.round(amount / 10000);
  return `${man < 0 ? "▲" : ""}${Math.abs(man).toLocaleString("ja-JP")}万円`;
}

/** 万円単位の符号付き(増減用)。例: ＋2,326万円 / ▲875万円 */
export function formatManYenDelta(amount: number): string {
  const man = Math.round(amount / 10000);
  if (man === 0) return "±0万円";
  return `${man < 0 ? "▲" : "＋"}${Math.abs(man).toLocaleString("ja-JP")}万円`;
}

/** "2026-12-18" → "12/18" */
export function formatMonthDay(date: string | null): string {
  if (!date) return "—";
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
}
