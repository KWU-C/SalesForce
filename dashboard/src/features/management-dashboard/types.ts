import type { ExpenseCategory } from "@/config/freeeExpenseClassification";

/**
 * 月次資金収支(会社版家計簿)のスナップショット。Firestore(monthlyCashFlowSnapshots)へ
 * 保存する集計値そのものの形。freeeの生レスポンスは保存しない(ユーザー確定、2026-09-14)。
 *
 * 会計上の売上・利益ではなく、実際の現金の動き(入金・支出)を主役とする
 * (ユーザー確定、2026-09-14)。
 */
export interface MonthlyCashFlow {
  /** freeeのfiscal_year(会計年度開始の西暦年) */
  fiscalYear: number;
  /** 暦月(1〜12) */
  month: number;

  /** 月初現預金(trial_bsのopening_balance合算) */
  cashOpening: number | null;
  /** 月末現預金(trial_bsのclosing_balance合算) */
  cashClosing: number | null;
  /** 実績の当月現金増減(cashClosing - cashOpening、これが正) */
  cashChange: number | null;

  /** 外部入金合計(自社口座間振替を除く) */
  externalIncome: number;
  /** 外部支出合計(自社口座間振替を除く) */
  externalExpenseTotal: number;

  /** 区分別の支出内訳(二重計上なし、1取引=1区分で代表分類) */
  expenseByCategory: Record<ExpenseCategory, number>;

  /** 営業キャッシュ収支 = externalIncome - (通常運営区分の支出合計) */
  operatingCashFlow: number;
  /** 財務キャッシュ収支 = -(借入返済等) */
  financingCashFlow: number;
  /** 積立・資産移動によるキャッシュ収支 = -(積立・資産移動) */
  assetTransferCashFlow: number;

  fetchedAt: Date;
}
