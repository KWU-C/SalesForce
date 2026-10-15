// クライアントコンポーネント(AccountingReportsSection)からも読み込むため、freee/Firestoreに依存する
// モジュールはimportしない(純粋な型・検証・計算だけを置く)。
import { getCurrentFiscalPeriod } from "@/config/fiscalPeriods";

/**
 * 経理月次報告・資金繰り予定(ユーザー確定、2026-10-15)。
 *
 * 経理が毎月作る資料の数字を「報告当時の値」として記録する。freeeの実績表示・「資金の備え」の
 * 算出とは独立したデータで、freeeの後日の変更によって自動で書き換わることはない。訂正・予測更新で
 * 上書きするときは、上書き前の値を履歴(revisions)に残す。実額はFirestoreにだけ置き、コード・
 * テスト・Gitには書かない。
 *
 * - 経理月次報告: 対象月までの売上高累計・経常利益累計(実績)。freeeとの差額はそのまま表示する
 * - 資金繰り予定: 対象月末の預金残高・引当の予定値。経理の担保控除額は、freeeの当座貸越利用額とは
 *   別項目として持つ(金額が一致していても同一視しない)
 */

export type AccountingReportKind = "monthly-report" | "cash-plan";

/** 既存の値を上書きする理由。初回登録はinitial */
export type ChangeType = "initial" | "correction" | "forecastUpdate";

export const CHANGE_TYPE_LABELS: Record<ChangeType, string> = {
  initial: "初回登録",
  correction: "訂正",
  forecastUpdate: "予測更新",
};

/** 種類ごとに、既存の値を上書きするときに選べる理由。経理月次報告は実績のため予測更新は無い */
export const ALLOWED_OVERWRITE_TYPES: Record<AccountingReportKind, readonly ChangeType[]> = {
  "monthly-report": ["correction"],
  "cash-plan": ["correction", "forecastUpdate"],
};

/** 経理月次報告の値(登録・訂正の単位) */
export interface MonthlyReportValues {
  /** 売上高累計(円)。資料に無ければnull */
  revenueCumulative: number | null;
  /** 経常利益累計(円、マイナス可) */
  ordinaryProfitCumulative: number | null;
  /** 資料に載っている前期同月累計(任意) */
  prevYearRevenueCumulative: number | null;
  prevYearOrdinaryProfitCumulative: number | null;
  /** 集計基準日(例: 「9月30日現在」→ 2026-09-30)。資料に無ければnull(推測で補完しない) */
  basisDate: string | null;
  /** 資料の報告日。資料に記載が無ければnull */
  reportDate: string | null;
  /** 資料名 */
  documentName: string;
  /** freeeとの差額の説明。未入力なら画面で「原因未確認」と表示する */
  differenceExplanation: string | null;
  note: string | null;
}

/** 資金繰り予定の値(対象月末の予定値、資料の数字をそのまま保存する) */
export interface CashPlanValues {
  /** 当座・普通預金合計 */
  checkingSavingsTotal: number | null;
  /** 定期預金月末予定残高(月中の定期積立を反映した値) */
  timeDepositTotal: number | null;
  /** 経理の担保控除額(当座貸越の担保枠)。freeeの当座貸越利用額とは別項目 */
  collateralDeduction: number | null;
  /** 預金総合計(担保控除後) */
  depositTotalAfterCollateral: number | null;
  consumptionTaxReserve: number | null;
  bonusReserve: number | null;
  /** 引当控除後の当座・普通預金合計 */
  checkingSavingsAfterReserves: number | null;
  /** 引当控除後の預金総合計 */
  depositTotalAfterReserves: number | null;
  /** 資料の更新日(例: 資金繰り表の「2026/10/14 更新」)。記載が無ければnull */
  sourceUpdatedOn: string | null;
  documentName: string;
  note: string | null;
}

export type ReportValues<K extends AccountingReportKind> = K extends "monthly-report" ? MonthlyReportValues : CashPlanValues;

/** 上書き前の値の履歴1件 */
export interface Revision<V> {
  values: V;
  /** 上書き前の値を登録・更新した人と日時 */
  previousUpdatedBy: string;
  previousUpdatedAt: string;
  /** 上書きの理由・実行者・日時 */
  changeType: ChangeType;
  changedBy: string;
  changedAt: string;
}

export interface StoredReport<V> {
  /** 対象月(YYYY-MM)。ドキュメントIDと同じ */
  targetMonth: string;
  values: V;
  /** 最新の値の登録理由 */
  changeType: ChangeType;
  /** システム登録日時(初回) */
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
  /** 古い順 */
  revisions: Revision<V>[];
}

export type MonthlyReport = StoredReport<MonthlyReportValues>;
export type CashPlan = StoredReport<CashPlanValues>;

// ---------------------------------------------------------------------------
// 入力検証(APIルートとリポジトリで共有する。クライアントの値は信用しない)

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** 誤入力対策の上限(絶対値1兆円) */
const AMOUNT_LIMIT = 1_000_000_000_000;
const TEXT_MAX = 2000;
const DOCUMENT_NAME_MAX = 200;

export function isTargetMonth(value: unknown): value is string {
  return typeof value === "string" && MONTH_PATTERN.test(value);
}

function isValidDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

type Parsed<T> = { ok: true; value: T } | { ok: false };
const fail = { ok: false } as const;

function parseAmount(value: unknown, allowNegative: boolean): Parsed<number | null> {
  if (value === null || value === undefined) return { ok: true, value: null };
  if (typeof value !== "number" || !Number.isInteger(value) || Math.abs(value) > AMOUNT_LIMIT) return fail;
  if (!allowNegative && value < 0) return fail;
  return { ok: true, value };
}

function parseDate(value: unknown): Parsed<string | null> {
  if (value === null || value === undefined || value === "") return { ok: true, value: null };
  return typeof value === "string" && isValidDate(value) ? { ok: true, value } : fail;
}

function parseText(value: unknown, max = TEXT_MAX): Parsed<string | null> {
  if (value === null || value === undefined) return { ok: true, value: null };
  if (typeof value !== "string" || value.length > max) return fail;
  const trimmed = value.trim();
  return { ok: true, value: trimmed === "" ? null : trimmed };
}

function parseFields<T>(
  raw: Record<string, unknown>,
  spec: Record<keyof T, (v: unknown) => Parsed<unknown>>
): T | null {
  const allowed = new Set(Object.keys(spec));
  if (Object.keys(raw).some((k) => !allowed.has(k))) return null;
  const result: Record<string, unknown> = {};
  for (const [key, parse] of Object.entries(spec) as [string, (v: unknown) => Parsed<unknown>][]) {
    const parsed = parse(raw[key]);
    if (!parsed.ok) return null;
    result[key] = parsed.value;
  }
  return result as T;
}

const money = (v: unknown) => parseAmount(v, false);
const signedMoney = (v: unknown) => parseAmount(v, true);

const MONTHLY_REPORT_SPEC: Record<keyof MonthlyReportValues, (v: unknown) => Parsed<unknown>> = {
  revenueCumulative: signedMoney,
  ordinaryProfitCumulative: signedMoney,
  prevYearRevenueCumulative: signedMoney,
  prevYearOrdinaryProfitCumulative: signedMoney,
  basisDate: parseDate,
  reportDate: parseDate,
  documentName: (v) => parseText(v, DOCUMENT_NAME_MAX),
  differenceExplanation: (v) => parseText(v),
  note: (v) => parseText(v),
};

const CASH_PLAN_SPEC: Record<keyof CashPlanValues, (v: unknown) => Parsed<unknown>> = {
  checkingSavingsTotal: signedMoney,
  timeDepositTotal: money,
  collateralDeduction: money,
  depositTotalAfterCollateral: signedMoney,
  consumptionTaxReserve: money,
  bonusReserve: money,
  checkingSavingsAfterReserves: signedMoney,
  depositTotalAfterReserves: signedMoney,
  sourceUpdatedOn: parseDate,
  documentName: (v) => parseText(v, DOCUMENT_NAME_MAX),
  note: (v) => parseText(v),
};

/**
 * 登録・訂正の値を検証する。未知の項目・型違い・範囲外は丸ごと拒否(null)。資料名は必須
 * (数値の出所を必ず残すため)。金額が1つも無い登録も拒否する。
 */
export function parseReportValues<K extends AccountingReportKind>(kind: K, raw: unknown): ReportValues<K> | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const spec = kind === "monthly-report" ? MONTHLY_REPORT_SPEC : CASH_PLAN_SPEC;
  const parsed = parseFields<Record<string, unknown>>(raw as Record<string, unknown>, spec as never);
  if (!parsed || !parsed.documentName) return null;
  const amountKeys = Object.entries(spec)
    .filter(([, p]) => p === money || p === signedMoney)
    .map(([k]) => k);
  if (amountKeys.every((k) => parsed[k] === null)) return null;
  return parsed as unknown as ReportValues<K>;
}

// ---------------------------------------------------------------------------
// 表示用の計算(保存値は書き換えない)

/** 対象月(YYYY-MM)の事業期・freee会計年度・暦月 */
export function targetMonthPeriod(targetMonth: string): { term: number; fiscalYear: number; month: number } {
  const [year, month] = targetMonth.split("-").map(Number);
  const { term } = getCurrentFiscalPeriod(new Date(year, month - 1, 15));
  return { term, fiscalYear: month >= 9 ? year : year - 1, month };
}

export function targetMonthLabel(targetMonth: string): string {
  const { term, month } = targetMonthPeriod(targetMonth);
  return `${term}期${month}月`;
}

export interface ConsistencyCheck {
  label: string;
  /** 資料の値 − 資料の他の項目から計算した値。検算できない(項目が欠けている)場合はnull */
  difference: number | null;
}

/**
 * 資金繰り予定の資料内検算。資料の数値は修正せず、合わない場合は差を返すだけ(画面で警告)。
 * - 当座・普通 ＋ 定期 − 担保控除 ＝ 預金総合計(担保控除後)
 * - 当座・普通 − 消費税引当 − 賞与引当 ＝ 引当控除後の当座・普通
 * - 預金総合計 − 消費税引当 − 賞与引当 ＝ 引当控除後の預金総合計
 */
export function checkCashPlan(v: CashPlanValues): ConsistencyCheck[] {
  const diff = (actual: number | null, ...terms: (number | null)[]): number | null => {
    if (actual === null || terms.some((t) => t === null)) return null;
    return actual - (terms as number[]).reduce((sum, t) => sum + t, 0);
  };
  const neg = (x: number | null) => (x === null ? null : -x);
  return [
    {
      label: "当座・普通＋定期−担保控除＝預金総合計",
      difference: diff(v.depositTotalAfterCollateral, v.checkingSavingsTotal, v.timeDepositTotal, neg(v.collateralDeduction)),
    },
    {
      label: "当座・普通−引当＝引当控除後の当座・普通",
      difference: diff(v.checkingSavingsAfterReserves, v.checkingSavingsTotal, neg(v.consumptionTaxReserve), neg(v.bonusReserve)),
    },
    {
      label: "預金総合計−引当＝引当控除後の預金総合計",
      difference: diff(v.depositTotalAfterReserves, v.depositTotalAfterCollateral, neg(v.consumptionTaxReserve), neg(v.bonusReserve)),
    },
  ];
}

/** freee比較値(月次P/Lスナップショットに保存した、その月末時点の累計) */
export interface FreeeCumulative {
  revenueCumulative: number | null;
  ordinaryProfitCumulative: number | null;
  /** freeeから取得した日時(月次P/Lスナップショットの取得日時) */
  fetchedAt: string;
}

/** 経理の値 − freeeの値。どちらかが無ければnull(0とみなさない) */
export function difference(accounting: number | null, freee: number | null | undefined): number | null {
  if (accounting === null || freee === null || freee === undefined) return null;
  return accounting - freee;
}

/** 対象月の新しい順 */
export function sortByTargetMonthDesc<T extends { targetMonth: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => b.targetMonth.localeCompare(a.targetMonth));
}
