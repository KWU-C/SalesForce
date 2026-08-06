import type { CrId, MonthlyProgress, ProgressKind } from "@/domain/types";

/**
 * DomainMapperに渡すコンテキスト。
 * どのCRのデータか（crId）はシート内容から判定できないため、
 * 呼び出し側（どのシートを取得したか知っているRepository層）が指定する。
 * kindは正規化テーブル（1シート=受注or完了のどちらか一方）でのみ必要。
 */
export interface DomainMapContext {
  crId: CrId;
  kind?: ProgressKind;
}

/** DomainMapperの戻り値。帳票によってはorder/completedの片方がnullになる */
export interface DomainMapResult {
  order: MonthlyProgress[] | null;
  completed: MonthlyProgress[] | null;
  warnings: string[];
}
