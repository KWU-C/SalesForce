import { describe, expect, it } from "vitest";
import type { FreeeTrialBalanceResponse, FreeeTrialBalanceRow } from "@/services/freee/freeeAccountingClient";
import { extractLoanStatus } from "./loanStatus";

function row(overrides: Partial<FreeeTrialBalanceRow>): FreeeTrialBalanceRow {
  return {
    hierarchy_level: 3,
    account_category_name: "他流動負債",
    opening_balance: 0,
    debit_amount: 0,
    credit_amount: 0,
    closing_balance: 0,
    composition_ratio: 0,
    ...overrides,
  };
}

describe("extractLoanStatus", () => {
  it("reads opening/closing/debit/credit per loan account and totals them", () => {
    const trialBs: FreeeTrialBalanceResponse = {
      company_id: 1,
      fiscal_year: 2025,
      balances: [
        row({ account_item_name: "短期借入金", opening_balance: 1000, closing_balance: 700, debit_amount: 300, credit_amount: 0 }),
        row({ account_item_name: "長期借入金", opening_balance: 5000, closing_balance: 5500, debit_amount: 0, credit_amount: 500 }),
        // 役員借入金: 行が無い(残高・動きゼロで省略されたケース)
      ],
    };

    const status = extractLoanStatus(trialBs);

    expect(status.lines).toEqual([
      { key: "shortTerm", label: "短期借入金", openingBalance: 1000, currentBalance: 700, newBorrowing: 0, repayment: 300 },
      { key: "longTerm", label: "長期借入金", openingBalance: 5000, currentBalance: 5500, newBorrowing: 500, repayment: 0 },
      { key: "officer", label: "役員借入金", openingBalance: 0, currentBalance: 0, newBorrowing: 0, repayment: 0 },
    ]);
    expect(status.totalOpening).toBe(6000);
    expect(status.totalCurrent).toBe(6200);
    expect(status.totalNewBorrowing).toBe(500);
    expect(status.totalRepayment).toBe(300);
    expect(status.netChange).toBe(200);
  });

  it("treats a fully missing response as all-zero (not an error)", () => {
    const empty: FreeeTrialBalanceResponse = { company_id: 1, fiscal_year: 2025, balances: [] };
    const status = extractLoanStatus(empty);
    expect(status.totalOpening).toBe(0);
    expect(status.totalCurrent).toBe(0);
    expect(status.netChange).toBe(0);
  });
});
