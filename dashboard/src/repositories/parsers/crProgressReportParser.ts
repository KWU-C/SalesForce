import type { CrId } from "@/domain/types";
import type { DomainMapContext, DomainMapResult } from "./domainMapping";
import {
  extractRawBlockData,
  mapRawBlockToMonthlyProgress,
  splitColumnsByTwoLabels,
  type RawBlockData,
} from "./reportBlockParser";
import { REPORT_LABELS } from "./reportLabels";

export interface CrProgressReportRaw {
  order: RawBlockData;
  completed: RawBlockData;
}

/**
 * Parser（帳票形式に依存する段）:
 * 「●CR別_月次営業まとめ」形式（1シートに受注・完了が左右のブロックとして
 * 並ぶ帳票）から生データを抽出する。セル座標は使わず、「受注」「完了」ラベルの
 * 位置からブロック（列範囲）を求め、各ブロック内で「売上」「粗利」「目標粗利」
 * 「粗利達成率」「◯月」を探索する。達成率の再計算等の業務ルールは持たない。
 */
export function parseCrProgressReportRaw(grid: string[][]): CrProgressReportRaw {
  const { a: orderRegion, b: completedRegion } = splitColumnsByTwoLabels(
    grid,
    REPORT_LABELS.order,
    REPORT_LABELS.completed
  );

  return {
    order: extractRawBlockData(grid, orderRegion, "受注ブロック"),
    completed: extractRawBlockData(grid, completedRegion, "完了ブロック"),
  };
}

/** DomainMapper（帳票形式に依存しない段）: 生データをMonthlyProgress[]へ変換する */
export function mapCrProgressReportToDomain(
  raw: CrProgressReportRaw,
  context: DomainMapContext
): DomainMapResult {
  const order = mapRawBlockToMonthlyProgress(raw.order, context.crId, "order", "受注ブロック");
  const completed = mapRawBlockToMonthlyProgress(
    raw.completed,
    context.crId,
    "completed",
    "完了ブロック"
  );

  return {
    order: order.rows,
    completed: completed.rows,
    warnings: [...order.warnings, ...completed.warnings],
  };
}

/** Parser+DomainMapperを合成した便利関数（単体利用・既存テスト向け） */
export function parseCrProgressReport(
  grid: string[][],
  crId: Exclude<CrId, "ALL">
): { order: NonNullable<DomainMapResult["order"]>; completed: NonNullable<DomainMapResult["completed"]>; warnings: string[] } {
  const result = mapCrProgressReportToDomain(parseCrProgressReportRaw(grid), { crId });
  return { order: result.order!, completed: result.completed!, warnings: result.warnings };
}
