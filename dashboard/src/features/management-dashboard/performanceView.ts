// クライアントコンポーネント(MonthlyPerformanceChart)からも読み込むため、freee/Firestoreに依存する
// モジュールは型以外importしない。
import type { MonthlyPerformance } from "./monthlyPerformance";

/** 1か月分の当期・前年同月の値。未取得の月はnull */
export interface PerformanceMonth {
  /** 暦月(1〜12) */
  month: number;
  current: MonthlyPerformance | null;
  previous: MonthlyPerformance | null;
}

export type AmountField =
  | "revenue"
  | "grossProfit"
  | "sga"
  | "operatingProfit"
  | "nonOperatingIncome"
  | "nonOperatingExpense"
  | "ordinaryProfit"
  | "laborCost"
  | "outsourcingCost"
  | "manufacturingConsignmentCost"
  | "buildingCost"
  | "motherExpense";

/** 1か月の値。未取得・freeeに区分が無い場合はnull(0円とは区別する) */
export function monthValue(performance: MonthlyPerformance | null, field: AmountField): number | null {
  return performance === null ? null : performance[field];
}

/** 合計。1か月でも欠けていればnull(欠けた月を0円として足さない) */
export function sumValues(values: (number | null)[]): number | null {
  if (values.length === 0) return null;
  let total = 0;
  for (const v of values) {
    if (v === null) return null;
    total += v;
  }
  return total;
}

export function cumulative(months: PerformanceMonth[], field: AmountField, side: "current" | "previous"): number | null {
  return sumValues(months.map((m) => monthValue(m[side], field)));
}

/** 比率(%) = 分子 ÷ 売上高 × 100。符号付き。売上高が0・未取得ならnull */
export function ratioToRevenue(value: number | null, revenue: number | null): number | null {
  if (value === null || revenue === null || revenue === 0) return null;
  return (value / revenue) * 100;
}

/** 前年比の増減率(%) = (当期 − 前年) ÷ |前年| × 100。前年が0・未取得ならnull */
export function changeRate(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/** その月の仕掛品振替の状況(事実のみ。月次決算の確定判定ではない) */
export function wipStatusLabel(performance: MonthlyPerformance | null): string {
  if (performance === null) return "未取得";
  return performance.wipTransferDetected ? "反映あり" : "未検出";
}

/** 仕掛品振替が未検出の当期の月(暦月) */
export function monthsWithoutWipTransfer(months: PerformanceMonth[]): number[] {
  return months.filter((m) => m.current !== null && !m.current.wipTransferDetected).map((m) => m.month);
}
