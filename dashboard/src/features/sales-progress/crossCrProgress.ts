import { CR_LIST } from "@/domain/types";
import type { CrProgress, MonthlyProgress } from "@/domain/types";
import { FISCAL_MONTH_ORDER, fiscalMonthIndex } from "@/config/fiscalPeriods";
import { summarizePeriod } from "./aggregate";

/** CR横断表の対象CR一覧。ALL(全社)は対象外、CR_LISTが増えれば自動で列も増える */
export const CROSS_CR_LIST = CR_LIST.filter((cr) => cr.id !== "ALL");

export interface CrossCrColumn {
  crId: string;
  crLabel: string;
  targetGrossProfit: number;
  orderGrossProfit: number | null;
  /** 当月粗利÷当月目標×100（未丸め）。合計行では意味を持たないためnull */
  orderMonthlyRate: number | null;
  /** 9月〜当該月までの累積粗利÷累積目標×100（summarizePeriod由来） */
  orderCumulativeRate: number | null;
  completedGrossProfit: number | null;
  completedMonthlyRate: number | null;
  completedCumulativeRate: number | null;
}

export interface CrossCrMonthRow {
  month: number;
  isCurrentMonth: boolean;
  columns: CrossCrColumn[];
}

export interface CrossCrProgress {
  monthRows: CrossCrMonthRow[];
  totalRow: CrossCrColumn[];
}

function monthlyRate(grossProfit: number | null, target: number): number | null {
  if (grossProfit === null) return null;
  if (target === 0) return 0;
  return (grossProfit / target) * 100;
}

function findRow(rows: MonthlyProgress[], month: number): MonthlyProgress | undefined {
  return rows.find((r) => r.month === month);
}

function buildMonthColumn(
  crId: string,
  crLabel: string,
  progress: CrProgress,
  month: number,
  cumulativeMonths: number[]
): CrossCrColumn {
  const orderRow = findRow(progress.order, month);
  const completedRow = findRow(progress.completed, month);
  const target = orderRow?.targetGrossProfit ?? completedRow?.targetGrossProfit ?? 0;

  const orderCumulative = summarizePeriod("", cumulativeMonths, progress.order);
  const completedCumulative = summarizePeriod("", cumulativeMonths, progress.completed);

  return {
    crId,
    crLabel,
    targetGrossProfit: target,
    orderGrossProfit: orderRow?.grossProfit ?? null,
    orderMonthlyRate: monthlyRate(orderRow?.grossProfit ?? null, target),
    orderCumulativeRate: orderCumulative.achievementRate,
    completedGrossProfit: completedRow?.grossProfit ?? null,
    completedMonthlyRate: monthlyRate(completedRow?.grossProfit ?? null, target),
    completedCumulativeRate: completedCumulative.achievementRate,
  };
}

function buildTotalColumn(
  crId: string,
  crLabel: string,
  progress: CrProgress,
  cumulativeMonths: number[]
): CrossCrColumn {
  const orderCumulative = summarizePeriod("", cumulativeMonths, progress.order);
  const completedCumulative = summarizePeriod("", cumulativeMonths, progress.completed);

  return {
    crId,
    crLabel,
    targetGrossProfit: orderCumulative.targetGrossProfit,
    orderGrossProfit: orderCumulative.grossProfit,
    orderMonthlyRate: null,
    orderCumulativeRate: orderCumulative.achievementRate,
    completedGrossProfit: completedCumulative.grossProfit,
    completedMonthlyRate: null,
    completedCumulativeRate: completedCumulative.achievementRate,
  };
}

/**
 * CR1・CR2・CR3を横方向に並べたCR横断進捗表のデータを組み立てる。
 * 表専用のSalesforce取得・集計は行わず、既存のprogressByCr(グラフ・月次表と
 * 同じ配列)とsummarizePeriod(既存の累積計算ロジック)だけを再利用する。
 *
 * 累積列は行ごとに「9月〜その行の月」までの範囲で計算する(FULL_YEARを使うと
 * 未到来月の目標まで分母に混ざってしまうため、必ず月ごとにスライスした範囲を渡す)。
 * 合計行は「9月〜現在月」までの累積(途中期なら年度末までではなく現在月まで)。
 */
export function buildCrossCrProgress(
  progressByCr: CrProgress[],
  currentMonth: number
): CrossCrProgress {
  const monthRows: CrossCrMonthRow[] = FISCAL_MONTH_ORDER.map((month, i) => {
    const cumulativeMonths = FISCAL_MONTH_ORDER.slice(0, i + 1);
    return {
      month,
      isCurrentMonth: month === currentMonth,
      columns: CROSS_CR_LIST.map((cr) => {
        const progress = progressByCr.find((p) => p.crId === cr.id)!;
        return buildMonthColumn(cr.id, cr.label, progress, month, cumulativeMonths);
      }),
    };
  });

  const totalCumulativeMonths = FISCAL_MONTH_ORDER.slice(0, fiscalMonthIndex(currentMonth));
  const totalRow: CrossCrColumn[] = CROSS_CR_LIST.map((cr) => {
    const progress = progressByCr.find((p) => p.crId === cr.id)!;
    return buildTotalColumn(cr.id, cr.label, progress, totalCumulativeMonths);
  });

  return { monthRows, totalRow };
}
