import { getConcreteCrIdsForTerm } from "@/domain/types";
import type { CrProgress, MonthlyProgress } from "@/domain/types";
import { FISCAL_MONTH_ORDER } from "@/config/fiscalPeriods";
import { summarizePeriod } from "./aggregate";

/**
 * CR横断表の対象CR一覧。ALL(全社)は対象外。事業期によって列数が変わる
 * (48・49期はCR1〜3、50期以降はCR1〜4、ユーザー確定2026-09-01)
 */
export function getCrossCrList(term: number): { id: string; label: string }[] {
  return getConcreteCrIdsForTerm(term).map((id) => ({ id, label: id }));
}

export interface CrossCrColumn {
  crId: string;
  crLabel: string;
  targetGrossProfit: number;
  orderGrossProfit: number | null;
  /** 当月粗利÷当月目標×100（未丸め）。合計行では意味を持たないためnull */
  orderMonthlyRate: number | null;
  /** 9月〜当該月までの累積粗利÷年間フル目標(12ヶ月分)×100（ユーザー確定、2026-09-13） */
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

/** 達成率の丸め方はsummarizePeriod(aggregate.ts)のachievementRateと揃える(小数点1桁) */
function rate(grossProfit: number | null, target: number): number | null {
  if (grossProfit === null) return null;
  if (target === 0) return 0;
  return Math.round((grossProfit / target) * 1000) / 10;
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
  // 累計%は月行・合計行とも常に年間フル目標(12ヶ月分)に対する達成率にする
  // （ユーザー確定、2026-09-13。目標(1ヶ月分、経過月按分ではない)自体は従来通り）
  const annualTarget = summarizePeriod("", FISCAL_MONTH_ORDER, progress.order).targetGrossProfit;

  return {
    crId,
    crLabel,
    targetGrossProfit: target,
    orderGrossProfit: orderRow?.grossProfit ?? null,
    orderMonthlyRate: rate(orderRow?.grossProfit ?? null, target),
    orderCumulativeRate: rate(orderCumulative.grossProfit, annualTarget),
    completedGrossProfit: completedRow?.grossProfit ?? null,
    completedMonthlyRate: rate(completedRow?.grossProfit ?? null, target),
    completedCumulativeRate: rate(completedCumulative.grossProfit, annualTarget),
  };
}

/**
 * 合計行は目標・実績とも年間フル12ヶ月分(FISCAL_MONTH_ORDER)を合算する
 * （ユーザー確定、2026-09-18。以前は実績側だけ「9月〜現在月」までに絞っていたため、
 * 期の始まったばかりの時期に先付けの実績(未到来月の受注・完了)が既に入っていても
 * 合計行に反映されず、「目標だけ合算されて実績は合算されていない」ように見える
 * 不整合があった。ページ上部の「累計（通年受注）」カード等、他の集計は元々
 * 現在月に関係なく実在する全月データを合算しており、それと矛盾しない挙動に統一する）。
 */
function buildTotalColumn(crId: string, crLabel: string, progress: CrProgress): CrossCrColumn {
  const orderCumulative = summarizePeriod("", FISCAL_MONTH_ORDER, progress.order);
  const completedCumulative = summarizePeriod("", FISCAL_MONTH_ORDER, progress.completed);
  const annualTarget = orderCumulative.targetGrossProfit;

  return {
    crId,
    crLabel,
    targetGrossProfit: annualTarget,
    orderGrossProfit: orderCumulative.grossProfit,
    orderMonthlyRate: null,
    orderCumulativeRate: rate(orderCumulative.grossProfit, annualTarget),
    completedGrossProfit: completedCumulative.grossProfit,
    completedMonthlyRate: null,
    completedCumulativeRate: rate(completedCumulative.grossProfit, annualTarget),
  };
}

/**
 * CR1・CR2・CR3を横方向に並べたCR横断進捗表のデータを組み立てる。
 * 表専用のSalesforce取得・集計は行わず、既存のprogressByCr(グラフ・月次表と
 * 同じ配列)とsummarizePeriod(既存の累積計算ロジック)だけを再利用する。
 *
 * 各月行の累積実績は「9月〜その行の月」までの範囲で計算する(FULL_YEARを使うと
 * 未到来月の実績まで0扱いで混ざってしまうため、必ず月ごとにスライスした範囲を渡す)。
 * 合計行は実在する全月(9月〜8月の12ヶ月)の実績・目標をそのまま合算する
 * （ユーザー確定、2026-09-18。buildTotalColumn参照）。
 */
export function buildCrossCrProgress(
  progressByCr: CrProgress[],
  currentMonth: number,
  term: number
): CrossCrProgress {
  const crossCrList = getCrossCrList(term);
  const monthRows: CrossCrMonthRow[] = FISCAL_MONTH_ORDER.map((month, i) => {
    const cumulativeMonths = FISCAL_MONTH_ORDER.slice(0, i + 1);
    return {
      month,
      isCurrentMonth: month === currentMonth,
      columns: crossCrList.map((cr) => {
        const progress = progressByCr.find((p) => p.crId === cr.id)!;
        return buildMonthColumn(cr.id, cr.label, progress, month, cumulativeMonths);
      }),
    };
  });

  const totalRow: CrossCrColumn[] = crossCrList.map((cr) => {
    const progress = progressByCr.find((p) => p.crId === cr.id)!;
    return buildTotalColumn(cr.id, cr.label, progress);
  });

  return { monthRows, totalRow };
}
