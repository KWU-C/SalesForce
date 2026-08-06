import { QUARTERS, HALVES, FULL_YEAR } from "@/config/fiscalPeriods";
import { parseNumber, parseNumberOrNull } from "@/services/google-sheets/cellValueParsing";
import type { CrId, MonthlyProgress, ProgressKind } from "@/domain/types";
import {
  cellAt,
  findCellsInRegion,
  findSingleCell,
  fullRegion,
  maxColumnIndex,
  type CellRegion,
  SheetParseError,
} from "./sheetGrid";
import {
  ACHIEVEMENT_RATE_TOLERANCE_POINTS,
  AMOUNT_TOLERANCE_YEN,
  REPORT_LABELS,
  monthLabel,
} from "./reportLabels";

/**
 * グリッド全体から2つのラベル(受注・完了のような左右に並ぶブロック見出し)を探し、
 * それぞれの列範囲（自分の見出し列 〜 もう一方の見出し列の手前 / グリッド末尾）に
 * 分割する。どちらが左でも右でも動く（間隔が変わっても、位置が入れ替わっても対応）。
 */
export function splitColumnsByTwoLabels(
  grid: string[][],
  labelA: string,
  labelB: string
): { a: CellRegion; b: CellRegion } {
  const region = fullRegion(grid);
  const cellA = findSingleCell(grid, labelA, region, "シート全体");
  const cellB = findSingleCell(grid, labelB, region, "シート全体");

  if (cellA.col === cellB.col) {
    throw new SheetParseError(
      `「${labelA}」と「${labelB}」が同じ列(${cellA.col})に見つかりました。左右のブロックを判別できません`
    );
  }

  const lastCol = maxColumnIndex(grid);
  const aIsLeft = cellA.col < cellB.col;

  const regionA: CellRegion = aIsLeft
    ? { ...region, colStart: cellA.col, colEnd: cellB.col - 1 }
    : { ...region, colStart: cellB.col, colEnd: lastCol };
  const regionB: CellRegion = aIsLeft
    ? { ...region, colStart: cellB.col, colEnd: lastCol }
    : { ...region, colStart: cellA.col, colEnd: cellB.col - 1 };

  return { a: regionA, b: regionB };
}

// ---------------------------------------------------------------------------
// 1段目: Parser（帳票形式に依存する生データ抽出）
// セル座標は使わずラベル探索で値を取り出すが、達成率の再計算や許容差判定と
// いった「業務ルール」は一切行わない。ここでは生の値を運ぶだけ。
// ---------------------------------------------------------------------------

export interface RawMonthlyCells {
  month: number;
  /** シート上のセルが空欄の場合はnull（未入力。0とは区別する） */
  sales: number | null;
  /** シート上のセルが空欄の場合はnull（未入力。0とは区別する） */
  grossProfit: number | null;
  targetGrossProfit: number;
  /** シート上に達成率列があった場合の生値。無ければnull（検算はDomainMapperが行う） */
  sheetAchievementRate: number | null;
}

export interface RawPeriodSubtotal {
  label: string;
  months: number[];
  /** シート上の集計セル（粗利）の生値 */
  grossProfit: number;
}

export interface RawBlockData {
  months: RawMonthlyCells[];
  periodSubtotals: RawPeriodSubtotal[];
}

/**
 * 1つのブロック（受注ブロック／完了ブロック等の列範囲）から、月別の
 * 売上・粗利・目標粗利・粗利達成率（シート上の生値）を抽出する。
 * 業務ルール（達成率の再計算・検算・警告）は持たない＝DomainMapperの責務。
 */
export function extractRawBlockData(
  grid: string[][],
  region: CellRegion,
  blockLabel: string
): RawBlockData {
  const salesRow = findSingleCell(grid, REPORT_LABELS.sales, region, blockLabel).row;
  const grossProfitRow = findSingleCell(grid, REPORT_LABELS.grossProfit, region, blockLabel).row;
  const targetRow = findSingleCell(
    grid,
    REPORT_LABELS.targetGrossProfit,
    region,
    blockLabel
  ).row;

  const achievementRateMatches = findCellsInRegion(grid, REPORT_LABELS.achievementRate, region);
  if (achievementRateMatches.length > 1) {
    throw new SheetParseError(
      `「${REPORT_LABELS.achievementRate}」が${blockLabel}内に${achievementRateMatches.length}件見つかりました`
    );
  }
  const achievementRateRow = achievementRateMatches[0]?.row ?? null;

  const monthColumns = new Map<number, number>();
  for (let month = 1; month <= 12; month += 1) {
    const matches = findCellsInRegion(grid, monthLabel(month), region);
    if (matches.length > 1) {
      throw new SheetParseError(
        `「${monthLabel(month)}」が${blockLabel}内に${matches.length}件見つかりました`
      );
    }
    if (matches.length === 1) monthColumns.set(month, matches[0].col);
  }

  if (monthColumns.size === 0) {
    throw new SheetParseError(`${blockLabel}内に月のラベル（1月〜12月）が1つも見つかりません`);
  }

  const months: RawMonthlyCells[] = [...monthColumns.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([month, col]) => {
      const sheetAchievementRateRaw =
        achievementRateRow !== null ? cellAt(grid, achievementRateRow, col) : undefined;

      return {
        month,
        sales: parseNumberOrNull(cellAt(grid, salesRow, col)),
        grossProfit: parseNumberOrNull(cellAt(grid, grossProfitRow, col)),
        targetGrossProfit: parseNumber(cellAt(grid, targetRow, col)),
        sheetAchievementRate:
          sheetAchievementRateRaw !== undefined && sheetAchievementRateRaw.trim() !== ""
            ? parseNumber(sheetAchievementRateRaw)
            : null,
      };
    });

  const periodSubtotals: RawPeriodSubtotal[] = [];
  for (const period of [...QUARTERS, ...HALVES, FULL_YEAR]) {
    const matches = findCellsInRegion(grid, period.label, region);
    if (matches.length !== 1) continue; // 存在しない・曖昧な場合は検算対象に含めない

    const raw = cellAt(grid, grossProfitRow, matches[0].col);
    if (raw === undefined || raw.trim() === "") continue;

    periodSubtotals.push({ label: period.label, months: period.months, grossProfit: parseNumber(raw) });
  }

  return { months, periodSubtotals };
}

// ---------------------------------------------------------------------------
// 2段目: DomainMapper（帳票形式に依存しない業務ルール）
// 達成率の再計算・シート値との検算・Domain型(MonthlyProgress)への変換を担う。
// ---------------------------------------------------------------------------

export interface BlockMapResult {
  rows: MonthlyProgress[];
  warnings: string[];
}

/**
 * 生データ(RawBlockData)をMonthlyProgress[]へ変換する。
 * - 粗利達成率は grossProfit ÷ targetGrossProfit × 100 で必ず再計算する
 * - シート側に達成率・期間集計の生値があれば、再計算/再集計値と比較し、
 *   許容範囲(reportLabels.tsのACHIEVEMENT_RATE_TOLERANCE_POINTS /
 *   AMOUNT_TOLERANCE_YEN)を超えたら警告を返す（例外は投げない）
 * - 期間集計(四半期/上半期/通期)の値そのものはDomainへ取り込まない
 */
export function mapRawBlockToMonthlyProgress(
  raw: RawBlockData,
  crId: CrId,
  kind: ProgressKind,
  blockLabel: string
): BlockMapResult {
  const warnings: string[] = [];

  const rows: MonthlyProgress[] = raw.months.map((cells) => {
    // grossProfitが未入力(null)の月は達成率も計算できない(null)。
    // 0との違い: 0は「実績0円と分かっている」、nullは「まだ入力されていない」。
    const achievementRate: number | null =
      cells.grossProfit === null
        ? null
        : cells.targetGrossProfit === 0
          ? 0
          : Math.round((cells.grossProfit / cells.targetGrossProfit) * 1000) / 10;

    if (cells.sheetAchievementRate !== null && achievementRate !== null) {
      if (Math.abs(cells.sheetAchievementRate - achievementRate) > ACHIEVEMENT_RATE_TOLERANCE_POINTS) {
        warnings.push(
          `[${blockLabel}] ${cells.month}月: 粗利達成率の差異（シート${cells.sheetAchievementRate}% / ` +
            `再計算${achievementRate}%）が許容範囲(±${ACHIEVEMENT_RATE_TOLERANCE_POINTS}pt)を超えています`
        );
      }
    }

    return {
      crId,
      kind,
      month: cells.month,
      sales: cells.sales,
      grossProfit: cells.grossProfit,
      targetGrossProfit: cells.targetGrossProfit,
      achievementRate,
    };
  });

  for (const subtotal of raw.periodSubtotals) {
    const monthsInRange = rows.filter((r) => subtotal.months.includes(r.month));
    const enteredMonths = monthsInRange.filter((r) => r.grossProfit !== null);
    // 対象期間の月が1つも入力されていなければ検算のしようがないためスキップ
    if (enteredMonths.length === 0) continue;

    const appGrossProfit = enteredMonths.reduce((sum, r) => sum + (r.grossProfit as number), 0);

    if (Math.abs(subtotal.grossProfit - appGrossProfit) > AMOUNT_TOLERANCE_YEN) {
      warnings.push(
        `[${blockLabel}] ${subtotal.label}: 粗利集計の差異（シート${subtotal.grossProfit} / ` +
          `月別データからの再集計${appGrossProfit}）が許容範囲(±${AMOUNT_TOLERANCE_YEN}円)を超えています` +
          (enteredMonths.length < monthsInRange.length
            ? `（${monthsInRange.length - enteredMonths.length}ヶ月分が未入力のため部分集計）`
            : "")
      );
    }
  }

  return { rows, warnings };
}
