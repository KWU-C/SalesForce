import { getSalesProgressDataSource } from "@/repositories/salesProgressRepository";

export interface SalesInputSummary {
  /** 当月受注(粗利) */
  orderGrossProfit: number | null;
  /** 当月受注(売上) */
  orderSales: number | null;
}

/**
 * 既存の営業進捗ダッシュボードと全く同じデータソース・同じ集計(crId="ALL")を
 * 再利用する。Salesforce側のロジックは一切変更しない(ユーザー確定、2026-09-14)。
 */
export async function getSalesInputSummary(term: number, calendarMonth: number): Promise<SalesInputSummary> {
  const dataSource = getSalesProgressDataSource();
  const progressByCr = await dataSource.getCrProgress(term);
  const all = progressByCr.find((p) => p.crId === "ALL") ?? null;
  const monthRow = all?.order.find((m) => m.month === calendarMonth) ?? null;
  return {
    orderGrossProfit: monthRow?.grossProfit ?? null,
    orderSales: monthRow?.sales ?? null,
  };
}
