import {
  FISCAL_MONTH_ORDER,
  calendarYearForTermMonth,
  freeeFiscalYearForTerm,
  getCurrentFiscalPeriod,
  previousFiscalTermMonth,
} from "@/config/fiscalPeriods";
import { actualKindsDifference, monthEndBoundary, resolveCashPlanActual } from "./accountingReports";
import type { CashPlan, MonthEndCashSnapshot } from "./accountingReports";
import type { MonthlyPerformanceSnapshot } from "./monthlyPerformance";
import type { CollateralDeductionSetting } from "./reserveSettings";

/**
 * 概要の経営サマリー(実績/進捗)・資金サマリー・収支予定(2026-11-13)の集計。保存済みのfreeeスナップショットから組み立て、freeeは呼ばない。どちらも取得時点の
 * freee帳簿の数値で、月次決算の確定は判定しない。
 *
 * - 実績: 日本時間の前月までの期首(9月)からの累計と、前月末の残高。月末前に取得したスナップショットは
 *   その月の月末実績ではないので欠けとして扱う(資金は資金繰り見通しと同じ resolveCashPlanActual で判定)
 * - 進捗: 当月を含む期首からの累計(freeeに登録済みの当月日付の取引を含む途中の値。予測ではない)
 * - 累計は単月値の合計。1か月でも欠けていれば出さない(0円とみなさない)
 * - 担保控除額は経理の管理値(managementReserveSettings.collateralDeduction)。無ければ担保控除後は未設定
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

export function targetMonth(term: number, month: number): TargetMonth {
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

export type CumulativeField = "revenue" | "grossProfit" | "operatingProfit" | "ordinaryProfit";

export interface PerformanceColumn {
  /** 累計の最終月 */
  through: TargetMonth;
  /** 累計の対象月(暦月、期首から) */
  months: number[];
  amounts: Record<CumulativeField, CumulativeAmount>;
  /** 当期で、保存が無い(実績では月末前の取得しか無い月も含む)月 */
  missingMonths: number[];
  /** 前年同期で、保存が無い月 */
  previousMissingMonths: number[];
  /** 当期の対象月のうち、仕掛品振替が未検出の月 */
  noWipTransferMonths: number[];
  /** 当期の対象月の取得日時の最古・最新。1か月も無ければnull */
  fetchedFrom: Date | null;
  fetchedTo: Date | null;
}

const FIELDS: CumulativeField[] = ["revenue", "grossProfit", "operatingProfit", "ordinaryProfit"];

function sumOrNull(values: (number | null)[]): number | null {
  if (values.length === 0 || values.some((v) => v === null)) return null;
  return (values as number[]).reduce((a, b) => a + b, 0);
}

/**
 * 期首から through までの累計を、当期・前年同期の両方について求める。
 * requireMonthEnd=true(実績)のときは、月末後に取得したスナップショットだけを使う。
 */
export function summarizePerformanceColumn(
  through: TargetMonth,
  lookup: PerformanceLookup,
  options: { requireMonthEnd: boolean }
): PerformanceColumn {
  const months = termMonthsThrough(through.month);
  const pick = (term: number, month: number): MonthlyPerformanceSnapshot | null => {
    const snapshot = lookup(freeeFiscalYearForTerm(term), month);
    if (snapshot === null) return null;
    if (options.requireMonthEnd && snapshot.fetchedAt.getTime() < monthEndBoundary(targetMonth(term, month).key).getTime()) {
      return null;
    }
    return snapshot;
  };
  const current = months.map((m) => pick(through.term, m));
  const previous = months.map((m) => pick(through.term - 1, m));
  const amounts = Object.fromEntries(
    FIELDS.map((field) => {
      const c = sumOrNull(current.map((s) => (s === null ? null : s[field])));
      const p = sumOrNull(previous.map((s) => (s === null ? null : s[field])));
      return [field, { current: c, previous: p, change: c === null || p === null ? null : c - p }];
    })
  ) as Record<CumulativeField, CumulativeAmount>;
  const fetched = current.filter((s): s is MonthlyPerformanceSnapshot => s !== null).map((s) => s.fetchedAt.getTime());
  return {
    through,
    months,
    amounts,
    missingMonths: months.filter((_, i) => current[i] === null),
    previousMissingMonths: months.filter((_, i) => previous[i] === null),
    noWipTransferMonths: months.filter((_, i) => current[i] !== null && !current[i]?.wipTransferDetected),
    fetchedFrom: fetched.length === 0 ? null : new Date(Math.min(...fetched)),
    fetchedTo: fetched.length === 0 ? null : new Date(Math.max(...fetched)),
  };
}

export type CashColumn =
  | { status: "notFetched"; collateral: CollateralDeductionSetting }
  | {
      status: "fetched";
      /** 当座・普通預金合計(定期預金・小口現金・保険積立金を含まない) */
      checkingSavings: number;
      timeDeposit: number;
      /** 預金合計(担保控除前) = 当座・普通 + 定期。小口現金は含まない */
      depositTotalBeforeCollateral: number;
      /** 預金総合計(担保控除後)。担保控除額が未設定ならnull。消費税準備・賞与準備は引かない */
      depositTotalAfterCollateral: number | null;
      collateral: CollateralDeductionSetting;
      /** 現預金残高(小口現金を含む。月次資金収支の月末現預金と同じ値) */
      cashClosing: number;
      /** 現預金残高と種類別合計の差(0以外なら分類できない科目がある) */
      kindsDifference: number;
      fetchedAt: Date;
    };

function fetchedColumn(
  values: { checkingSavings: number; timeDeposit: number; cashOnHand: number; cashClosing: number; fetchedAt: Date },
  collateral: CollateralDeductionSetting
): CashColumn {
  const before = values.checkingSavings + values.timeDeposit;
  return {
    status: "fetched",
    checkingSavings: values.checkingSavings,
    timeDeposit: values.timeDeposit,
    depositTotalBeforeCollateral: before,
    depositTotalAfterCollateral: collateral.amount === null ? null : before - collateral.amount,
    collateral,
    cashClosing: values.cashClosing,
    kindsDifference: actualKindsDifference({ ...values, fetchedAt: values.fetchedAt.toISOString() }),
    fetchedAt: values.fetchedAt,
  };
}

/** 前月末の残高。月末後に取得したスナップショットだけを使う */
export function summarizePreviousMonthCash(
  target: TargetMonth,
  snapshot: MonthEndCashSnapshot | null,
  collateral: CollateralDeductionSetting,
  now: Date
): CashColumn {
  const actual = resolveCashPlanActual(target.key, snapshot, now);
  if (actual.status !== "fetched") return { status: "notFetched", collateral };
  return fetchedColumn({ ...actual, fetchedAt: new Date(actual.fetchedAt) }, collateral);
}

/** 翌月(期をまたぐ場合は次期の9月) */
export function nextTargetMonth(target: TargetMonth): TargetMonth {
  const index = FISCAL_MONTH_ORDER.indexOf(target.month);
  return index === FISCAL_MONTH_ORDER.length - 1
    ? targetMonth(target.term + 1, FISCAL_MONTH_ORDER[0])
    : targetMonth(target.term, FISCAL_MONTH_ORDER[index + 1]);
}

/**
 * 収支予定: 指定した月末ごとに、登録済みの経理の資金繰り予定(cashPlanForecasts)を対応させる。登録が無い月は
 * plan=null(未算出)。現在残高・前月末残高やfreeeの予定からの推計で埋めない。
 */
export function selectCashPlanOutlook(
  plans: readonly CashPlan[],
  months: readonly TargetMonth[]
): { target: TargetMonth; plan: CashPlan | null }[] {
  return months.map((target) => ({ target, plan: plans.find((p) => p.targetMonth === target.key) ?? null }));
}
