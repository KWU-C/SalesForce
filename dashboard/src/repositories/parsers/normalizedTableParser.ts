import { indexRowsByHeader } from "@/services/google-sheets/readTableByHeader";
import { mapRecordsToMonthlyProgress } from "@/repositories/googleSheetsRecordMapper";
import type { CrId, MonthlyProgress, ProgressKind } from "@/domain/types";
import type { DomainMapContext, DomainMapResult } from "./domainMapping";

/**
 * 1行目がヘッダー行の正規化テーブル用Parser。
 * 現行の帳票形式シート（crProgressReportParser等）とは別に、将来の正規化された
 * 入力シートやBigQuery等のテーブル形式データソースのために残している。
 * 現状どのGoogleSheetsSalesProgressDataSourceからも使われていない。
 *
 * 正規化テーブルは1シート＝受注or完了のどちらか一方を表す想定のため、
 * DomainMapContextに kind（"order" | "completed"）の指定が必須。
 */
export function parseNormalizedTableRaw(grid: string[][]): Record<string, string>[] {
  return indexRowsByHeader(grid);
}

export function mapNormalizedTableToDomain(
  records: Record<string, string>[],
  context: DomainMapContext
): DomainMapResult {
  if (!context.kind) {
    throw new Error(
      "normalizedTableParser: DomainMapContext.kind（受注/完了の指定）が必要です"
    );
  }

  const rows = mapRecordsToMonthlyProgress(records, context.crId, context.kind);

  return context.kind === "order"
    ? { order: rows, completed: null, warnings: [] }
    : { order: null, completed: rows, warnings: [] };
}

/** Parser+DomainMapperを合成した便利関数（単体利用向け） */
export function parseNormalizedTable(
  grid: string[][],
  crId: CrId,
  kind: ProgressKind
): MonthlyProgress[] {
  const result = mapNormalizedTableToDomain(parseNormalizedTableRaw(grid), { crId, kind });
  return (kind === "order" ? result.order : result.completed) ?? [];
}
