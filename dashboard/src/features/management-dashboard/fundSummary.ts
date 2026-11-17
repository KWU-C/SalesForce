import { previousFiscalTermMonth } from "@/config/fiscalPeriods";
import { resolveCashPlanActual } from "./accountingReports";
import type { MonthEndCashSnapshot } from "./accountingReports";
import { targetMonth, type TargetMonth } from "./overviewComparison";
import type { ReferenceForecastRecord, ReferenceMonthEndReserveMonth, ReferencePaymentReserveItem } from "./referenceForecast";

/**
 * 概要「資金サマリー」(2026-11-17、ユーザー指定で「資金サマリー」「資金残高」を1つに統合)。
 *
 * 主表: 月末 × 区分(実績・予測) × 当座・普通預金合計 / 預金総合計(当座・普通・定期)。
 * - 実績: 締まった直近2か月の月末。freeeの月次資金収支スナップショット(月末後に取得したもの)の種類別残高
 * - 予測: 当月末。保存済みの参考予測(手動計算・自動更新なし)の標準ケース。慎重ケースと月中の最低残高は補足
 * - 預金総合計は現金を含めない。担保・引当の控除前
 * - 予測の定期預金 = 起点の定期預金 + 予測期間中の定期積立(予測の出来事「振替:定期積立」)
 */

export type FundActualRow =
  | { kind: "actual"; target: TargetMonth; status: "fetched"; checkingSavings: number; depositTotal: number; fetchedAt: Date }
  | { kind: "actual"; target: TargetMonth; status: "notFetched" };

export interface FundForecastRow {
  kind: "forecast";
  target: TargetMonth;
  /** 標準ケースの月末(当座・普通) */
  checkingSavings: number;
  /** 標準ケースの月末の預金総合計(当座・普通＋定期) */
  depositTotal: number;
  timeDeposit: number;
  cautious: { checkingSavings: number; depositTotal: number } | null;
  /** 月中の日末残高の最低(当座・普通) */
  standardMin: { date: string | null; amount: number };
  cautiousMin: { date: string | null; amount: number } | null;
}

export type FundForecastState =
  | { status: "available"; row: FundForecastRow; baseDate: string; computedAt: string }
  | { status: "unavailable"; target: TargetMonth; reason: string };

const TIME_DEPOSIT_CATEGORY = "振替:定期積立";

/** 締まった直近2か月(古い順)。前月と前々月 */
export function actualTargets(previousMonth: TargetMonth): TargetMonth[] {
  const before = previousFiscalTermMonth(previousMonth.term, previousMonth.month);
  return [targetMonth(before.term, before.month), previousMonth];
}

export function buildActualRow(target: TargetMonth, snapshot: MonthEndCashSnapshot | null, now: Date): FundActualRow {
  const actual = resolveCashPlanActual(target.key, snapshot, now);
  if (actual.status !== "fetched") return { kind: "actual", target, status: "notFetched" };
  return {
    kind: "actual",
    target,
    status: "fetched",
    checkingSavings: actual.checkingSavings,
    depositTotal: actual.checkingSavings + actual.timeDeposit,
    fetchedAt: new Date(actual.fetchedAt),
  };
}

/** 予測の月末の定期預金。起点の定期 + 対象月までの定期積立(当座・普通からの出金を定期へ振り替えた額) */
export function forecastTimeDeposit(record: ReferenceForecastRecord, caseId: string, monthKey: string): number | null {
  const c = record.cash.cases.find((x) => x.id === caseId);
  if (!c || !c.months.some((m) => m.month === monthKey)) return null;
  const transferred = c.months
    .filter((m) => m.month <= monthKey)
    .reduce((sum, m) => sum - (m.byCategory[TIME_DEPOSIT_CATEGORY] ?? 0), 0);
  return record.cash.startTimeDeposit + transferred;
}

/** 予測の計算日時(引き継いだ記録では元の資金予測の計算日時) */
export function forecastComputedAt(record: ReferenceForecastRecord): string {
  return record.cashComputedAt ?? record.createdAt;
}

export function buildForecastState(record: ReferenceForecastRecord | null, target: TargetMonth): FundForecastState {
  if (record === null) return { status: "unavailable", target, reason: "参考予測の記録がありません（本番では表示しません）" };
  const month = (caseId: string) => record.cash.cases.find((c) => c.id === caseId)?.months.find((m) => m.month === target.key) ?? null;
  const standard = month("standard");
  const standardTime = forecastTimeDeposit(record, "standard", target.key);
  if (standard === null || standardTime === null) {
    return { status: "unavailable", target, reason: `保存済みの参考予測（基準日 ${record.baseDate}）に${target.month}月末の予測がありません` };
  }
  const cautious = month("cautious");
  const cautiousTime = forecastTimeDeposit(record, "cautious", target.key);
  return {
    status: "available",
    baseDate: record.baseDate,
    computedAt: forecastComputedAt(record),
    row: {
      kind: "forecast",
      target,
      checkingSavings: standard.end,
      depositTotal: standard.end + standardTime,
      timeDeposit: standardTime,
      cautious: cautious && cautiousTime !== null ? { checkingSavings: cautious.end, depositTotal: cautious.end + cautiousTime } : null,
      standardMin: standard.minEndOfDay,
      cautiousMin: cautious?.minEndOfDay ?? null,
    },
  };
}

export interface ReserveDeduction {
  month: string;
  /** 標準ケースの月末(当座・普通) */
  forecastBalance: number;
  /** 予測に含まれているため差し引かない支払見込 */
  included: ReferencePaymentReserveItem[];
  /** 予測に未反映のため差し引く支払見込(準備額) */
  deducted: ReferencePaymentReserveItem[];
  deductedTotal: number;
  balanceAfter: number;
}

/** その月末の予測残高に、支払見込が既に含まれているか(予測へ反映された月がその月以前) */
export function isReflectedBy(item: ReferencePaymentReserveItem, monthKey: string): boolean {
  return item.reflectedInForecastFrom !== null && item.reflectedInForecastFrom <= monthKey;
}

/**
 * 控除後残高 = 標準ケースの月末残高(当座・普通) − 予測に未反映の支払見込額の合計。
 * 予測に含まれる支払(例: 12月末なら12月の賞与振込)は差し引かない(二重に引かない)。
 */
export function reserveDeductions(record: ReferenceForecastRecord): ReserveDeduction[] {
  const items = record.paymentReserve?.items ?? [];
  const standard = record.cash.cases.find((c) => c.id === "standard");
  if (!standard || items.length === 0) return [];
  return standard.months.map((m) => {
    const included = items.filter((i) => isReflectedBy(i, m.month));
    const deducted = items.filter((i) => !isReflectedBy(i, m.month));
    const deductedTotal = deducted.reduce((s, i) => s + i.amount, 0);
    return { month: m.month, forecastBalance: m.end, included, deducted, deductedTotal, balanceAfter: m.end - deductedTotal };
  });
}

/**
 * 概要の主表の1行(2026-11-17、経理資料と比べられる計算構成)。
 * 預金総合計 − 控除額(freeeの短期借入金) = 短期借入控除後
 * 短期借入控除後 − 納税・賞与の準備額 = 準備額控除後の参考残高
 * 控除額・準備額は保存済みの記録(monthEndReserve)の同じ月末の値。無ければ null(表示しない)
 */
export interface FundComparisonRow {
  target: TargetMonth;
  kind: "actual" | "forecast";
  checkingSavings: number | null;
  depositTotal: number | null;
  /** 欠けている理由(預金残高が無いとき) */
  missingReason: string | null;
  reserveMonth: ReferenceMonthEndReserveMonth | null;
  deduction: number | null;
  afterDeduction: number | null;
  reserve: number | null;
  afterReserve: number | null;
}

export function buildComparisonRows(
  actualRows: FundActualRow[],
  forecast: FundForecastState,
  record: ReferenceForecastRecord | null
): FundComparisonRow[] {
  const months = record?.monthEndReserve?.months ?? [];
  const make = (
    target: TargetMonth,
    kind: "actual" | "forecast",
    deposits: { checkingSavings: number; depositTotal: number } | null,
    missingReason: string | null
  ): FundComparisonRow => {
    const expectKind = kind === "actual" ? "実績" : "予測";
    const rm = months.find((m) => m.month === target.key && m.kind === expectKind) ?? null;
    const deduction = rm?.shortTermBorrowing ?? null;
    const reserve = rm?.reserveTotal ?? null;
    const afterDeduction = deposits && deduction !== null ? deposits.depositTotal - deduction : null;
    return {
      target,
      kind,
      checkingSavings: deposits?.checkingSavings ?? null,
      depositTotal: deposits?.depositTotal ?? null,
      missingReason,
      reserveMonth: rm,
      deduction,
      afterDeduction,
      reserve,
      afterReserve: afterDeduction !== null && reserve !== null ? afterDeduction - reserve : null,
    };
  };
  const rows = actualRows.map((r) =>
    r.status === "fetched"
      ? make(r.target, "actual", r, null)
      : make(r.target, "actual", null, "月末後にfreeeから取得した値が無いため表示していません")
  );
  rows.push(
    forecast.status === "available"
      ? make(forecast.row.target, "forecast", forecast.row, null)
      : make(forecast.target, "forecast", null, forecast.reason)
  );
  return rows;
}
