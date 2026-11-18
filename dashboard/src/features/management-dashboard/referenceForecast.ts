/**
 * 資金・損益の参考予測(DEVのみ、2026-11-17)。
 *
 * 計算はローカルの scripts/reference-forecast(Python)か、DEVの画面の再計算(referenceForecastEngine、2026-11-18)で行い、
 * 結果の集計だけを referenceForecasts に1件ずつ追加保存する(既存の記録は上書きしない。月末後に予測と実績を照合できるよう過去の記録は残す)。
 * 画面は最新の1件を表示する。取引先名・個人名・口座番号は持たない。
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
  /** 含めるべきだが、データを取得できず含められていない支出(2026-11-18〜。無ければ省略) */
  missingOutflows?: string[];
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
      /** 推計に使った過去明細からの集計・ケースごとの仮定(2026-11-18) */
      adjustments?: Record<string, unknown>;
    };
  };
  matching: {
    byClass: { label: string; count: number; amount: number }[];
    ambiguous: { class: string; reason: string; count: number; amount: number }[];
    freeeUnmatchedUnsettled: { count: number; amount: number };
  };
  pl: { scenarios: ReferencePlScenario[] };
  notes: { basis: string[]; estimates: string[]; limits: string[] };
  /** 元の記録から資金・損益を引き継いだ記録の、元の記録ID(2026-11-17、支払準備の追加) */
  derivedFrom?: string;
  /** 資金予測を計算した日時。無ければ createdAt */
  cashComputedAt?: string;
  /** 納税・賞与の支払準備(参考)。freeeの実績・予定からの集計(scripts/reference-forecast/payment_reserve.py) */
  paymentReserve?: ReferencePaymentReserve;
  /** 資金サマリーの控除額(短期借入)・納税・賞与の準備額。月末ごと(scripts/reference-forecast/month_end_reserve.py、2026-11-17) */
  monthEndReserve?: ReferenceMonthEndReserve;
  /** 計算の方法(2026-11-18)。devRecompute=DEVの画面の再計算。無ければローカルの手動計算 */
  computeMode?: "devRecompute";
  /** 銀行明細の最終日(連携口座の明細がある最後の日)。予測の基準日 */
  bankSyncedThrough?: string;
  /** freeeの口座の最終更新日の範囲(銀行口座) */
  walletableUpdateRange?: { min: string | null; max: string | null };
  /** 準備額・支払見込額を計算した日時 */
  reserveComputedAt?: string;
  /** 損益(pl)を引き継いだ元の記録ID(DEVの再計算では損益を再計算しない) */
  plCarriedFrom?: string;
  /** 損益・準備額を引き継いだ元の記録ID(ローカルの再計算、2026-11-18) */
  carriedFrom?: string;
}

/**
 * 月末の準備額(手元に残しておく額の目安)。支払見込額(次に支払う額)とは別の計算。
 * - 消費税: 月末までに発生し未納付の額 = 未払消費税等 + 仮受 − 仮払 − 当期の中間納付済み (+ 予測月は仮定の月次発生額 × 月数)
 * - 賞与: 次回支給見込額 × 経過月数 ÷ 積立月数
 */
export interface ReferenceMonthEndReserveMonth {
  /** YYYY-MM */
  month: string;
  kind: "実績" | "予測";
  /** freeeの短期借入金の月末残高(予測の月は取得時点) */
  shortTermBorrowing: number;
  shortTermBorrowingByBank: { bank: string; amount: number }[];
  /** 短期借入金の品目がすべて当座貸越か */
  overdraftOnly: boolean;
  consumptionTax: {
    payable: number;
    received: number;
    paid: number;
    interimPaid: number;
    /** 予測の月だけ: 直近の締まった月末から加えた仮定の月数と1か月分の発生額 */
    assumedMonths: number;
    assumedMonthly: number;
    amount: number;
  };
  bonus: { estimate: number; elapsedMonths: number; spanMonths: number; amount: number };
  reserveTotal: number;
}

export interface ReferenceMonthEndReserve {
  fetchedAt: string;
  months: ReferenceMonthEndReserveMonth[];
  /** 準備額の計算の仮定 */
  assumptions: string[];
  /** 控除額(短期借入)の確認。経理資料の「担保」と同じ意味とはしていない理由 */
  deductionCheck: string[];
}

/** 将来の支払見込(1件)。会計上の引当金残高・管理上の準備額ではない */
export interface ReferencePaymentReserveItem {
  id: string;
  label: string;
  /** 支払う月(YYYY-MM) */
  targetMonth: string;
  amount: number;
  /** 予定: freeeに登録済み・確定の明細 / 推計: 実績からの推計(根拠に式を書く) */
  kind: "予定" | "推計";
  /** 資金予測に出金として含まれている場合、その月(YYYY-MM)。含まれていなければ null */
  reflectedInForecastFrom: string | null;
  basis: string;
}

export interface ReferencePaymentReserve {
  fetchedAt: string;
  /** 会計上の残高(試算表、前月末)。支払見込額・準備額ではない */
  accounting: {
    asOf: string;
    bonusProvision: number;
    consumptionTaxPayable: number;
    consumptionTaxReceived: number;
    consumptionTaxPaid: number;
  };
  items: ReferencePaymentReserveItem[];
  history: {
    consumptionTax: { date: string; amount: number; kind: string }[];
    bonus: { label: string; payDate: string | null; gross: number; deductions: number; net: number }[];
  };
  limits: string[];
  /** 集計の確かめ(年度・税目・範囲・決算振替との照合) */
  verification?: { consumptionTax: string[] };
  /** 参考残高に含めていない支払(資金余力ではない理由) */
  notIncluded?: string[];
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
  for (const item of r.paymentReserve?.items ?? []) {
    if (!Number.isFinite(item.amount) || item.amount < 0) errors.push(`支払準備 ${item.id} の金額が正の数値ではありません`);
    if (!/^\d{4}-\d{2}$/.test(item.targetMonth)) errors.push(`支払準備 ${item.id} の対象月の形式が違います`);
    if (item.reflectedInForecastFrom !== null && !/^\d{4}-\d{2}$/.test(item.reflectedInForecastFrom)) {
      errors.push(`支払準備 ${item.id} の予測への反映月の形式が違います`);
    }
  }
  for (const m of r.monthEndReserve?.months ?? []) {
    if (!/^\d{4}-\d{2}$/.test(m.month)) errors.push(`準備額 ${m.month} の月の形式が違います`);
    const parts = [m.shortTermBorrowing, m.consumptionTax?.amount, m.bonus?.amount, m.reserveTotal];
    if (!parts.every((v) => Number.isFinite(v) && v >= 0)) errors.push(`準備額 ${m.month} の金額が正の数値ではありません`);
    else if (m.consumptionTax.amount + m.bonus.amount !== m.reserveTotal) errors.push(`準備額 ${m.month} の合計が内訳と一致しません`);
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

/** 円・3桁区切り(財務・資金繰り、業績・採算タブ。2026-11-18、万円から円へ)。例: 66,311,876円 / ▲80,000,000円 */
export function formatYenInt(amount: number): string {
  const v = Math.round(amount);
  return `${v < 0 ? "▲" : ""}${Math.abs(v).toLocaleString("ja-JP")}円`;
}

/** 円の符号付き(増減用)。例: ＋23,260,000円 / ▲875,000円 */
export function formatYenDelta(amount: number): string {
  const v = Math.round(amount);
  if (v === 0) return "±0円";
  return `${v < 0 ? "▲" : "＋"}${Math.abs(v).toLocaleString("ja-JP")}円`;
}

/** "2026-12-18" → "12/18" */
export function formatMonthDay(date: string | null): string {
  if (!date) return "—";
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
}
