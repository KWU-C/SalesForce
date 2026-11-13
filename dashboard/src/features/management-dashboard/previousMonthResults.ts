import {
  FISCAL_MONTH_ORDER,
  calendarYearForTermMonth,
  freeeFiscalYearForTerm,
  getCurrentFiscalPeriod,
  previousFiscalTermMonth,
} from "@/config/fiscalPeriods";
import { actualKindsDifference, monthEndBoundary, resolveCashPlanActual } from "./accountingReports";
import type { MonthEndCashSnapshot } from "./accountingReports";
import type { MonthlyPerformanceSnapshot } from "./monthlyPerformance";

/**
 * 概要「前月末までの実績」(2026-11-13)。経理の月次報告で見ている売上高累計・経常利益累計と、前月末の
 * 当座・普通預金合計・預金総合計(担保控除後)を、保存済みのfreeeスナップショットから組み立てる。
 * freeeは呼ばない。値は取得日時点のfreee帳簿上の数値で、月次決算の確定は判定しない。
 *
 * - 対象月は日本時間の「前月」(サーバーはUTCで動くため、ローカル時刻の月は使わない)。9月なら前期8月
 * - 業績は期首(9月)〜対象月の単月値の合計。1か月でも欠けていれば累計は出さない(0円とみなさない)。
 *   月末前に取得したスナップショットはその月の月末実績ではないので、欠けとして扱う
 * - 資金は対象月の月次資金収支スナップショットの種類別月末残高。月末前の取得分は使わない
 *   (資金繰り見通しと同じ resolveCashPlanActual で判定)
 * - 担保控除額は経理の管理値で、freeeの残高・当座貸越の枠・利用額・担保定期の残高のどれとも同一視しない。
 *   値が無ければ「預金総合計(担保控除後)」は未設定にする(控除前の合計を同じ名前で出さない)
 */

export interface TargetMonth {
  term: number;
  /** freeeのfiscal_year(期首の西暦年) */
  fiscalYear: number;
  /** 暦月(1〜12) */
  month: number;
  /** その月の西暦年 */
  calendarYear: number;
  /** YYYY-MM */
  key: string;
}

function targetMonth(term: number, month: number): TargetMonth {
  const calendarYear = calendarYearForTermMonth(term, month);
  return {
    term,
    fiscalYear: freeeFiscalYearForTerm(term),
    month,
    calendarYear,
    key: `${calendarYear}-${String(month).padStart(2, "0")}`,
  };
}

/** 日本時間で見た前月 */
export function previousMonthInJst(now: Date): TargetMonth {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  // getCurrentFiscalPeriodはローカル時刻の年月を読むので、日本時間の年月を持つローカル日付を渡す
  const { term, currentMonth } = getCurrentFiscalPeriod(new Date(jst.getUTCFullYear(), jst.getUTCMonth(), 15));
  const previous = previousFiscalTermMonth(term, currentMonth);
  return targetMonth(previous.term, previous.month);
}

/** 期首(9月)から対象月までの暦月 */
function termMonthsThrough(month: number): number[] {
  return FISCAL_MONTH_ORDER.slice(0, FISCAL_MONTH_ORDER.indexOf(month) + 1);
}

/** 保存済みの月次業績を(fiscal_year, 暦月)で引く。読み込んでいない・保存が無い月はnull */
export type PerformanceLookup = (fiscalYear: number, month: number) => MonthlyPerformanceSnapshot | null;

export interface CumulativeAmount {
  /** 当期累計。欠けた月があればnull */
  current: number | null;
  /** 前年同期(前期の同じ月まで)の累計。欠けた月があればnull */
  previous: number | null;
  /** 当期 − 前年同期。どちらかがnullならnull */
  change: number | null;
}

export interface PreviousMonthPerformance {
  target: TargetMonth;
  /** 累計の対象月(暦月、期首から) */
  months: number[];
  revenue: CumulativeAmount;
  ordinaryProfit: CumulativeAmount;
  /** 当期で、保存が無い・月末前の取得しか無い月(暦月) */
  missingMonths: number[];
  /** 前年同期で、保存が無い・月末前の取得しか無い月(暦月) */
  previousMissingMonths: number[];
  /** 当期の対象月のうち、仕掛品振替が未検出の月(暦月) */
  noWipTransferMonths: number[];
  /** 当期の対象月の取得日時の最古・最新。1か月も無ければnull */
  fetchedFrom: Date | null;
  fetchedTo: Date | null;
}

function monthKey(term: number, month: number): string {
  return targetMonth(term, month).key;
}

/** 月末後に取得した保存値だけを使う。月末前の取得分・保存なしはnull */
function monthEndSnapshot(lookup: PerformanceLookup, term: number, month: number): MonthlyPerformanceSnapshot | null {
  const snapshot = lookup(freeeFiscalYearForTerm(term), month);
  if (snapshot === null) return null;
  return snapshot.fetchedAt.getTime() < monthEndBoundary(monthKey(term, month)).getTime() ? null : snapshot;
}

function sumOrNull(values: (number | null)[]): number | null {
  if (values.length === 0 || values.some((v) => v === null)) return null;
  return (values as number[]).reduce((a, b) => a + b, 0);
}

function cumulativeAmount(
  current: (MonthlyPerformanceSnapshot | null)[],
  previous: (MonthlyPerformanceSnapshot | null)[],
  field: "revenue" | "ordinaryProfit"
): CumulativeAmount {
  const c = sumOrNull(current.map((s) => (s === null ? null : s[field])));
  const p = sumOrNull(previous.map((s) => (s === null ? null : s[field])));
  return { current: c, previous: p, change: c === null || p === null ? null : c - p };
}

export function summarizePreviousMonthPerformance(target: TargetMonth, lookup: PerformanceLookup): PreviousMonthPerformance {
  const months = termMonthsThrough(target.month);
  const current = months.map((m) => monthEndSnapshot(lookup, target.term, m));
  const previous = months.map((m) => monthEndSnapshot(lookup, target.term - 1, m));
  const fetched = current.filter((s): s is MonthlyPerformanceSnapshot => s !== null).map((s) => s.fetchedAt.getTime());
  return {
    target,
    months,
    revenue: cumulativeAmount(current, previous, "revenue"),
    ordinaryProfit: cumulativeAmount(current, previous, "ordinaryProfit"),
    missingMonths: months.filter((_, i) => current[i] === null),
    previousMissingMonths: months.filter((_, i) => previous[i] === null),
    noWipTransferMonths: months.filter((_, i) => current[i] !== null && !current[i]?.wipTransferDetected),
    fetchedFrom: fetched.length === 0 ? null : new Date(Math.min(...fetched)),
    fetchedTo: fetched.length === 0 ? null : new Date(Math.max(...fetched)),
  };
}

/** 経理の担保控除額。管理設定が無ければ amount=null(未設定) */
export interface CollateralDeduction {
  amount: number | null;
}

export type PreviousMonthCash =
  | { target: TargetMonth; status: "notFetched" }
  | {
      target: TargetMonth;
      status: "fetched";
      /** 当座・普通預金合計(定期預金・小口現金・保険積立金を含まない) */
      checkingSavings: number;
      timeDeposit: number;
      /** 預金合計(担保控除前) = 当座・普通 + 定期。小口現金は含まない */
      depositTotalBeforeCollateral: number;
      /** 預金総合計(担保控除後)。担保控除額が未設定ならnull */
      depositTotalAfterCollateral: number | null;
      /** 月末現預金と種類別合計の差(0以外なら分類できない科目がある) */
      kindsDifference: number;
      fetchedAt: Date;
    };

export function summarizePreviousMonthCash(
  target: TargetMonth,
  snapshot: MonthEndCashSnapshot | null,
  collateral: CollateralDeduction,
  now: Date
): PreviousMonthCash {
  const actual = resolveCashPlanActual(target.key, snapshot, now);
  if (actual.status !== "fetched") return { target, status: "notFetched" };
  const before = actual.checkingSavings + actual.timeDeposit;
  return {
    target,
    status: "fetched",
    checkingSavings: actual.checkingSavings,
    timeDeposit: actual.timeDeposit,
    depositTotalBeforeCollateral: before,
    depositTotalAfterCollateral: collateral.amount === null ? null : before - collateral.amount,
    kindsDifference: actualKindsDifference(actual),
    fetchedAt: new Date(actual.fetchedAt),
  };
}
