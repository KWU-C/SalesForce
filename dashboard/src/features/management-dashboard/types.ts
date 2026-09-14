/**
 * 月次経営ダッシュボードのスナップショット。Firestore(monthlyFinanceSnapshots)へ
 * 保存する集計値そのものの形。freeeの生レスポンスは保存しない(ユーザー確定、2026-09-14)。
 */
export interface MonthlyFinanceSnapshot {
  /** freeeのfiscal_year(会計年度開始の西暦年) */
  fiscalYear: number;
  /** 暦月(1〜12) */
  month: number;

  sales: number | null;
  grossProfit: number | null;
  /** % */
  grossMargin: number | null;
  laborCost: number | null;
  outsourcingCost: number | null;
  otherSga: number | null;
  operatingProfit: number | null;
  /** % */
  operatingMargin: number | null;
  ordinaryProfit: number | null;

  cashOpening: number | null;
  cashClosing: number | null;
  cashChange: number | null;
  accountsReceivable: number | null;
  accountsPayable: number | null;
  unpaidExpenses: number | null;
  borrowings: number | null;

  fetchedAt: Date;
}
