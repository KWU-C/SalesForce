import { formatYen } from "@/utils/format";
import { OPERATING_CATEGORIES, FINANCING_AND_RESERVE_CATEGORIES } from "@/config/freeeExpenseClassification";
import type { ExpenseCategory } from "@/config/freeeExpenseClassification";
import { ExpenseCompositionSection } from "./ExpenseCompositionSection";
import { RefreshMonthButton } from "./RefreshMonthButton";
import type { MonthlyCashFlow } from "./types";

const CATEGORY_LABEL: Record<ExpenseCategory, string> = {
  labor: "人件費",
  outsourcing: "外注費",
  taxSocial: "税金・社会保険等",
  otherOperating: "諸経費",
  other: "その他",
  financing: "借入返済",
  assetTransfer: "積立・資産移動",
};

function Line({ label, value, indent = false, bold = false }: { label: string; value: number; indent?: boolean; bold?: boolean }) {
  return (
    <div className={`flex items-center justify-between py-1 text-sm ${indent ? "pl-4" : ""}`}>
      <span className={bold ? "font-medium text-[var(--text-primary)]" : "text-[var(--text-secondary)]"}>
        {label}
      </span>
      <span className={`tabular-nums ${bold ? "font-semibold text-[var(--text-primary)]" : "text-[var(--text-primary)]"}`}>
        {formatYen(value)}
      </span>
    </div>
  );
}

interface MonthlyCashFlowTableProps {
  fiscalYear: number;
  month: number;
  cashFlow: MonthlyCashFlow;
}

/**
 * 月次資金収支表(会社版家計簿)。会計上の利益ではなく実際の現金の動きを主役とする
 * (ユーザー確定、2026-09-14)。月初現預金→入金→支出→営業CF→財務→当月増減→月末現預金
 * という流れで、その月の資金状態を一つの流れとして把握できるようにする。
 */
export function MonthlyCashFlowTable({ fiscalYear, month, cashFlow }: MonthlyCashFlowTableProps) {
  const operatingExpenseTotal = OPERATING_CATEGORIES.reduce((sum, c) => sum + cashFlow.expenseByCategory[c], 0);
  // trial_bs実績の当月現金増減(cashChange)と、区分集計から積み上げた増減には
  // 集計方法の違いによる残差が生じ得る(8月実データ検証で約101.7%相当の一致を確認済み)。
  // 実績値(cashChange)を正としつつ、集計ベースの内訳も併記し差異を隠さない
  const computedChange = cashFlow.operatingCashFlow + cashFlow.financingCashFlow + cashFlow.assetTransferCashFlow;
  const reconciliationGap =
    cashFlow.cashChange !== null ? cashFlow.cashChange - computedChange : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-[var(--text-secondary)]">月次資金収支（会社版家計簿）</h2>
        <RefreshMonthButton fiscalYear={fiscalYear} month={month} />
      </div>

      <div className="rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)] p-4">
        <Line label="月初現預金" value={cashFlow.cashOpening ?? 0} bold />

        <div className="mt-3 border-t border-[var(--gridline)] pt-2">
          <p className="text-xs font-medium text-[var(--text-muted)]">入金</p>
          <Line label="外部入金" value={cashFlow.externalIncome} indent />
        </div>

        <div className="mt-2 border-t border-[var(--gridline)] pt-2">
          <p className="text-xs font-medium text-[var(--text-muted)]">支出</p>
          {OPERATING_CATEGORIES.map((c) => (
            <Line key={c} label={CATEGORY_LABEL[c]} value={cashFlow.expenseByCategory[c]} indent />
          ))}
          <Line label="支出計" value={operatingExpenseTotal} bold />
        </div>

        <div className="mt-2 border-t border-[var(--gridline)] pt-2">
          <Line label="営業キャッシュ収支" value={cashFlow.operatingCashFlow} bold />
        </div>

        <div className="mt-3 border-t-2 border-[var(--baseline)] pt-2">
          <p className="text-xs font-medium text-[var(--text-muted)]">財務・将来準備</p>
          {FINANCING_AND_RESERVE_CATEGORIES.map((c) => (
            <Line key={c} label={CATEGORY_LABEL[c]} value={-cashFlow.expenseByCategory[c]} indent />
          ))}
        </div>

        <div className="mt-3 border-t-2 border-[var(--baseline)] pt-2">
          <Line label="当月現金増減（実績）" value={cashFlow.cashChange ?? computedChange} bold />
          {reconciliationGap !== null && Math.abs(reconciliationGap) > 0 && (
            <p className="pl-4 text-xs text-[var(--text-muted)]">
              （区分集計との差異: {formatYen(reconciliationGap)}）
            </p>
          )}
          <Line label="月末現預金" value={cashFlow.cashClosing ?? 0} bold />
        </div>
      </div>

      <ExpenseCompositionSection
        expenseByCategory={cashFlow.expenseByCategory}
        externalExpenseTotal={cashFlow.externalExpenseTotal}
      />
    </div>
  );
}
