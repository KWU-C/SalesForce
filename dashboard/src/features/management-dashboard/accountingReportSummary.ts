import { FISCAL_MONTH_ORDER } from "@/config/fiscalPeriods";
import { difference, targetMonthPeriod } from "./accountingReports";
import type { MonthlyReport } from "./accountingReports";
import { targetMonth } from "./overviewComparison";
import type { PerformanceColumn, TargetMonth } from "./overviewComparison";

/**
 * 概要の一番上「経理報告」(2026-11-16、ユーザー指定: 経理報告PDFの再現)の組み立て。
 *
 * - 経理月次報告(accountingMonthlyReports)の登録がある月＝経理が月次報告を出した(経理確認済みの)月
 * - 表示するのは、締まった月(日本時間の前月)以前で最も新しい登録月の報告。金額は資料の値をそのまま出し、
 *   freeeの値で置き換えない(freee帳簿の同じ期間の累計は、照合用に差だけ添える)
 * - 前月の報告が未登録なら、その旨を出す(登録済みの古い月の報告を前月分のようには見せない)
 * - 目標との差は、資料に書かれた月次目標×期首からの月数で計算する(資料の書き方に合わせ、通期÷12にはしない)
 */

export interface AccountingReportSummary {
  report: MonthlyReport;
  /** 報告の対象月 */
  target: TargetMonth;
  /** 期首(9月)から対象月までの月数 */
  monthCount: number;
  /** 集計基準日(資料の記載。無ければ対象月の月末) */
  basis: { month: number; day: number; fromDocument: boolean };
  revenue: number | null;
  previousRevenue: number | null;
  revenueChange: number | null;
  ordinaryProfit: number | null;
  previousOrdinaryProfit: number | null;
  ordinaryProfitChange: number | null;
  operatingProfit: number | null;
  monthlyRevenueTarget: number | null;
  /** 月次目標 × 月数。どちらかが無ければnull */
  cumulativeRevenueTarget: number | null;
  /** 売上高累計 − 目標累計(マイナス=下回る) */
  revenueTargetGap: number | null;
  annualRevenueTarget: number | null;
  /** 資金繰りの注視事項(1行1項目、空行は除く) */
  cashWatchItems: string[];
  /** 締まった月(前月)の報告が未登録で、それより前の報告を出しているか */
  latestClosedMissing: boolean;
}

export type AccountingReportSummaryResult =
  | { status: "none"; latestClosed: TargetMonth }
  | ({ status: "registered"; latestClosed: TargetMonth } & AccountingReportSummary);

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function lastDayOfMonth(calendarYear: number, month: number): number {
  return new Date(Date.UTC(calendarYear, month, 0)).getUTCDate();
}

function subtract(a: number | null, b: number | null): number | null {
  return a === null || b === null ? null : a - b;
}

/**
 * 締まった月(latestClosed)以前で最も新しい経理月次報告を選び、表示用に組み立てる。
 * 追加前に保存した報告に無い項目は未記載(null)として読む。
 */
export function summarizeAccountingReport(
  reports: readonly MonthlyReport[],
  latestClosed: TargetMonth
): AccountingReportSummaryResult {
  const candidates = reports
    .filter((r) => r.targetMonth <= latestClosed.key)
    .sort((a, b) => b.targetMonth.localeCompare(a.targetMonth));
  const report = candidates[0];
  if (!report) return { status: "none", latestClosed };

  const { term, month } = targetMonthPeriod(report.targetMonth);
  const target = targetMonth(term, month);
  const v = report.values as unknown as Record<string, unknown>;
  const monthCount = FISCAL_MONTH_ORDER.indexOf(month) + 1;

  const basisDate = text(v.basisDate);
  const basis = basisDate
    ? { month: Number(basisDate.slice(5, 7)), day: Number(basisDate.slice(8, 10)), fromDocument: true }
    : { month, day: lastDayOfMonth(target.calendarYear, month), fromDocument: false };

  const revenue = num(v.revenueCumulative);
  const previousRevenue = num(v.prevYearRevenueCumulative);
  const ordinaryProfit = num(v.ordinaryProfitCumulative);
  const previousOrdinaryProfit = num(v.prevYearOrdinaryProfitCumulative);
  const monthlyRevenueTarget = num(v.monthlyRevenueTarget);
  const cumulativeRevenueTarget = monthlyRevenueTarget === null ? null : monthlyRevenueTarget * monthCount;

  return {
    status: "registered",
    latestClosed,
    report,
    target,
    monthCount,
    basis,
    revenue,
    previousRevenue,
    revenueChange: subtract(revenue, previousRevenue),
    ordinaryProfit,
    previousOrdinaryProfit,
    ordinaryProfitChange: subtract(ordinaryProfit, previousOrdinaryProfit),
    operatingProfit: num(v.operatingProfitCumulative),
    monthlyRevenueTarget,
    cumulativeRevenueTarget,
    revenueTargetGap: subtract(revenue, cumulativeRevenueTarget),
    annualRevenueTarget: num(v.annualRevenueTarget),
    cashWatchItems: (text(v.cashWatchItems) ?? "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== ""),
    latestClosedMissing: report.targetMonth < latestClosed.key,
  };
}

/** 経理報告の値とfreee帳簿(月末後に取得した同じ期間の累計)の照合。freeeが無ければ freee=null */
export interface FreeeCrossCheck {
  freee: number | null;
  /** freee − 経理。どちらかが無ければnull */
  difference: number | null;
}

export function crossCheck(reported: number | null, freeeColumn: PerformanceColumn | null, field: "revenue" | "ordinaryProfit" | "operatingProfit"): FreeeCrossCheck {
  const freee = freeeColumn?.amounts[field].current ?? null;
  return { freee, difference: difference(freee, reported) };
}

/**
 * 資料と同じ「億・万・円」の書き方(例: 2,594万2,217円、6億4,000万円、▲1,316万4,531円)。
 * 1円単位まで出し、丸めない。
 */
export function formatOkuManYen(amount: number): string {
  const negative = amount < 0;
  const abs = Math.abs(Math.round(amount));
  const oku = Math.floor(abs / 100_000_000);
  const man = Math.floor((abs % 100_000_000) / 10_000);
  const yen = abs % 10_000;
  const parts = [
    oku > 0 ? `${oku.toLocaleString("ja-JP")}億` : "",
    man > 0 ? `${man.toLocaleString("ja-JP")}万` : "",
    yen > 0 ? yen.toLocaleString("ja-JP") : "",
  ].join("");
  return `${negative ? "▲" : ""}${parts === "" ? "0" : parts}円`;
}
