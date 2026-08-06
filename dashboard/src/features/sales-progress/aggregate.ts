import type { MonthlyProgress, PeriodSummary } from "@/domain/types";

/**
 * 期間内のsales/grossProfitを合算する。未入力(null)の月は無視する。
 * 期間内の月が1つも入力されていなければnull（0とは区別する）。
 */
function sumOrNull(rows: MonthlyProgress[], field: "sales" | "grossProfit"): number | null {
  const entered = rows.filter((r) => r[field] !== null);
  if (entered.length === 0) return null;
  return entered.reduce((sum, r) => sum + (r[field] as number), 0);
}

export function summarizePeriod(
  label: string,
  months: number[],
  data: MonthlyProgress[]
): PeriodSummary {
  const inRange = data.filter((d) => months.includes(d.month));

  const sales = sumOrNull(inRange, "sales");
  const grossProfit = sumOrNull(inRange, "grossProfit");
  const targetGrossProfit = inRange.reduce((sum, d) => sum + d.targetGrossProfit, 0);
  const achievementRate =
    grossProfit === null
      ? null
      : targetGrossProfit === 0
        ? 0
        : Math.round((grossProfit / targetGrossProfit) * 1000) / 10;

  return { label, months, sales, grossProfit, targetGrossProfit, achievementRate };
}
