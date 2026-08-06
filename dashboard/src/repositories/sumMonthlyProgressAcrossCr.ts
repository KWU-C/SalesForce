import { fiscalMonthIndex } from "@/config/fiscalPeriods";
import type { MonthlyProgress, ProgressKind } from "@/domain/types";

/**
 * CR1〜CR3の月別データを「月の値」でグルーピングして合算する（全社=ALL）。
 * 配列の並び順・要素数がCRごとに異なっていても（行順が違う、月が欠けている等）
 * 正しく合算できる。将来「全社シート」を直接読む方式に切り替える場合は、
 * この関数を使わず該当シートを読むDataSource実装に差し替えるだけでよい。
 *
 * sales/grossProfitが未入力(null)のCRは合算に含めない。対象月について
 * 全CRが未入力ならnull（0とは区別する）。
 */
export function sumMonthlyProgressAcrossCr(
  perCr: MonthlyProgress[][],
  kind: ProgressKind
): MonthlyProgress[] {
  const byMonth = new Map<
    number,
    { sales: number | null; grossProfit: number | null; targetGrossProfit: number }
  >();

  for (const series of perCr) {
    for (const row of series) {
      const acc = byMonth.get(row.month) ?? {
        sales: null,
        grossProfit: null,
        targetGrossProfit: 0,
      };
      if (row.sales !== null) acc.sales = (acc.sales ?? 0) + row.sales;
      if (row.grossProfit !== null) acc.grossProfit = (acc.grossProfit ?? 0) + row.grossProfit;
      acc.targetGrossProfit += row.targetGrossProfit;
      byMonth.set(row.month, acc);
    }
  }

  return [...byMonth.entries()]
    .sort(([a], [b]) => fiscalMonthIndex(a) - fiscalMonthIndex(b))
    .map(([month, acc]) => ({
      crId: "ALL" as const,
      kind,
      month,
      sales: acc.sales,
      grossProfit: acc.grossProfit,
      targetGrossProfit: acc.targetGrossProfit,
      achievementRate:
        acc.grossProfit === null
          ? null
          : acc.targetGrossProfit === 0
            ? 0
            : Math.round((acc.grossProfit / acc.targetGrossProfit) * 1000) / 10,
    }));
}
