import { GOOGLE_SHEETS_HEADER_NAMES } from "@/config/googleSheets";
import { parseMonth, parseNumber } from "@/services/google-sheets/cellValueParsing";
import type { CrId, MonthlyProgress, ProgressKind } from "@/domain/types";

/**
 * ヘッダー名で引いたレコード（indexRowsByHeaderの出力）をMonthlyProgress[]へ変換する。
 * 列の並び順・位置には一切依存しない。
 * 「月」列がない行・月として解釈できない行（小計行等）はスキップする。
 */
export function mapRecordsToMonthlyProgress(
  records: Record<string, string>[],
  crId: CrId,
  kind: ProgressKind
): MonthlyProgress[] {
  const result: MonthlyProgress[] = [];

  for (const record of records) {
    const month = parseMonth(record[GOOGLE_SHEETS_HEADER_NAMES.month]);
    if (month === null) continue;

    const sales = parseNumber(record[GOOGLE_SHEETS_HEADER_NAMES.sales]);
    const grossProfit = parseNumber(record[GOOGLE_SHEETS_HEADER_NAMES.grossProfit]);
    const targetGrossProfit = parseNumber(
      record[GOOGLE_SHEETS_HEADER_NAMES.targetGrossProfit]
    );

    const achievementRateRaw = record[GOOGLE_SHEETS_HEADER_NAMES.achievementRate];
    const achievementRate =
      achievementRateRaw !== undefined && achievementRateRaw !== ""
        ? parseNumber(achievementRateRaw)
        : targetGrossProfit === 0
          ? 0
          : Math.round((grossProfit / targetGrossProfit) * 1000) / 10;

    result.push({ crId, kind, month, sales, grossProfit, targetGrossProfit, achievementRate });
  }

  return result;
}
