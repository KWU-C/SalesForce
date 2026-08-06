import { GOOGLE_SHEETS_HEADER_NAMES } from "@/config/googleSheets";
import {
  mapCompanyProgressReportToDomain,
  parseCompanyProgressReportRaw,
} from "./parsers/companyProgressReportParser";
import {
  mapCrProgressReportToDomain,
  parseCrProgressReportRaw,
} from "./parsers/crProgressReportParser";
import {
  mapNormalizedTableToDomain,
  parseNormalizedTableRaw,
} from "./parsers/normalizedTableParser";
import { REPORT_LABELS } from "./parsers/reportLabels";
import type { ReportDefinition } from "./reportRegistry";
import { ReportRegistry } from "./reportRegistry";

/**
 * CR別・月次営業まとめ（受注/完了が左右ブロックの帳票形式）。
 * 「受注」「完了」の両方を必須とすることで、全社推移シート（受注/完了の
 * ブロック構造を持たない可能性がある）と区別する。
 */
export const CR_PROGRESS_REPORT: ReportDefinition<ReturnType<typeof parseCrProgressReportRaw>> = {
  name: "CR別月次営業まとめ",
  requiredLabels: [
    REPORT_LABELS.order,
    REPORT_LABELS.completed,
    REPORT_LABELS.sales,
    REPORT_LABELS.grossProfit,
    REPORT_LABELS.targetGrossProfit,
  ],
  parser: parseCrProgressReportRaw,
  domainMapper: mapCrProgressReportToDomain,
};

/**
 * 全社推移（構造未確認）。
 * 「受注」「完了」を必須にしない緩い定義にしているため、CR別シートも
 * ラベル充足条件だけで見れば一致しうるが、ReportRegistryはrequiredLabelsが
 * より多い（＝より具体的な）CR_PROGRESS_REPORTを優先するため誤判定しない。
 */
export const COMPANY_PROGRESS_REPORT: ReportDefinition<
  ReturnType<typeof parseCompanyProgressReportRaw>
> = {
  name: "全社推移",
  requiredLabels: [REPORT_LABELS.sales, REPORT_LABELS.grossProfit, REPORT_LABELS.targetGrossProfit],
  parser: parseCompanyProgressReportRaw,
  domainMapper: mapCompanyProgressReportToDomain,
};

/** 1行目がヘッダー行の正規化テーブル（将来の正規化入力シート・BigQuery等向け） */
export const NORMALIZED_TABLE_REPORT: ReportDefinition<ReturnType<typeof parseNormalizedTableRaw>> = {
  name: "正規化テーブル",
  requiredLabels: [
    GOOGLE_SHEETS_HEADER_NAMES.month,
    GOOGLE_SHEETS_HEADER_NAMES.sales,
    GOOGLE_SHEETS_HEADER_NAMES.grossProfit,
    GOOGLE_SHEETS_HEADER_NAMES.targetGrossProfit,
  ],
  parser: parseNormalizedTableRaw,
  domainMapper: mapNormalizedTableToDomain,
};

/** 現在把握している全帳票を登録済みのレジストリを作る */
export function createDefaultReportRegistry(): ReportRegistry {
  const registry = new ReportRegistry();
  registry.register(CR_PROGRESS_REPORT);
  registry.register(COMPANY_PROGRESS_REPORT);
  registry.register(NORMALIZED_TABLE_REPORT);
  return registry;
}
