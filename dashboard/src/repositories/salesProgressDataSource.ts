import type { CrProgress } from "@/domain/types";

/**
 * 売上・粗利進捗データの取得元を抽象化するポート。
 * UI層・集計層(features/sales-progress)はこのインターフェースの
 * 戻り値（CrProgress[]）だけを見ればよく、取得元（モック／Google Sheets／
 * 将来のSalesforce・freee・BigQuery等）を意識しない。
 */
export interface SalesProgressDataSource {
  /** termを省略した場合は現在の事業期を使う（各実装がgetCurrentFiscalPeriod()で解決） */
  getCrProgress(term?: number): Promise<CrProgress[]>;
  /** 期セレクター用。データが存在する事業期の一覧（降順）を返す */
  getAvailableTerms(): Promise<number[]>;
}
