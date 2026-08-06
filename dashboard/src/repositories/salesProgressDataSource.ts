import type { CrProgress } from "@/domain/types";

/**
 * 売上・粗利進捗データの取得元を抽象化するポート。
 * UI層・集計層(features/sales-progress)はこのインターフェースの
 * 戻り値（CrProgress[]）だけを見ればよく、取得元（モック／Google Sheets／
 * 将来のSalesforce・freee・BigQuery等）を意識しない。
 */
export interface SalesProgressDataSource {
  getCrProgress(currentMonth: number): Promise<CrProgress[]>;
}
