import type { DomainMapContext, DomainMapResult } from "./domainMapping";
import {
  extractRawBlockData,
  mapRawBlockToMonthlyProgress,
  splitColumnsByTwoLabels,
  type RawBlockData,
} from "./reportBlockParser";
import { REPORT_LABELS } from "./reportLabels";
import { fullRegion, SheetParseError } from "./sheetGrid";

export interface CompanyProgressReportRaw {
  order: RawBlockData | null;
  completed: RawBlockData;
  /** 受注/完了の左右ブロックが見つからず単一ブロックにフォールバックした場合 */
  fallback?: { reason: string };
}

/**
 * Parser（帳票形式に依存する段）: 全社推移シート用。
 *
 * 要検証: 実際の全社推移シートはまだ確認できていない
 * （ユーザーより「CRごとのシートと全社推移シートで構造が異なる」との情報のみ）。
 * 現状は次の2段構えにしている。
 *   1. CRシートと同じ「受注」「完了」の左右ブロック構造を試みる
 *   2. 見つからなければ、グリッド全体を単一ブロックとして解析する
 *      （全社シートが受注/完了を分けず単一の推移のみを持つ場合を想定）
 * 実シート確認後、実際の構造に合わせて書き換える前提の実装。
 */
export function parseCompanyProgressReportRaw(grid: string[][]): CompanyProgressReportRaw {
  try {
    const { a: orderRegion, b: completedRegion } = splitColumnsByTwoLabels(
      grid,
      REPORT_LABELS.order,
      REPORT_LABELS.completed
    );

    return {
      order: extractRawBlockData(grid, orderRegion, "受注ブロック(全社)"),
      completed: extractRawBlockData(grid, completedRegion, "完了ブロック(全社)"),
    };
  } catch (error) {
    if (!(error instanceof SheetParseError)) throw error;

    return {
      order: null,
      completed: extractRawBlockData(grid, fullRegion(grid), "全社推移ブロック"),
      fallback: { reason: error.message },
    };
  }
}

/** DomainMapper（帳票形式に依存しない段） */
export function mapCompanyProgressReportToDomain(
  raw: CompanyProgressReportRaw,
  context: DomainMapContext
): DomainMapResult {
  const completedBlockLabel = raw.fallback ? "全社推移ブロック" : "完了ブロック(全社)";
  const completed = mapRawBlockToMonthlyProgress(
    raw.completed,
    context.crId,
    "completed",
    completedBlockLabel
  );
  const order = raw.order
    ? mapRawBlockToMonthlyProgress(raw.order, context.crId, "order", "受注ブロック(全社)")
    : null;

  const warnings = [
    ...(raw.fallback
      ? [`受注/完了の左右ブロック構造が見つからなかったため単一ブロックとして解析しました（${raw.fallback.reason}）`]
      : []),
    ...(order?.warnings ?? []),
    ...completed.warnings,
  ];

  return { order: order?.rows ?? null, completed: completed.rows, warnings };
}

/** Parser+DomainMapperを合成した便利関数（単体利用・既存テスト向け） */
export function parseCompanyProgressReport(grid: string[][]): DomainMapResult {
  return mapCompanyProgressReportToDomain(parseCompanyProgressReportRaw(grid), { crId: "ALL" });
}
