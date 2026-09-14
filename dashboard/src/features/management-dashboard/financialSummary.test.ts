import { afterEach, describe, expect, it, vi } from "vitest";
import type { FreeeTrialBalanceResponse, FreeeTrialBalanceRow, FreeeWalletable } from "@/services/freee/freeeAccountingClient";
import { extractBsSummary, extractPlSummary, sumCashAndDeposits } from "./financialSummary";

function row(overrides: Partial<FreeeTrialBalanceRow>): FreeeTrialBalanceRow {
  return {
    account_item_id: null,
    account_item_name: null,
    hierarchy_level: 1,
    account_category_name: "",
    opening_balance: 0,
    debit_amount: 0,
    credit_amount: 0,
    closing_balance: 0,
    composition_ratio: 0,
    ...overrides,
  };
}

function trialPlFixture(): FreeeTrialBalanceResponse {
  return {
    company_id: 1,
    fiscal_year: 2025,
    balances: [
      row({ hierarchy_level: 2, account_item_name: "売上高", account_category_name: "売上高", closing_balance: 1000 }),
      row({ hierarchy_level: 1, account_item_name: null, account_category_name: "売上高", closing_balance: 1000 }),
      row({
        hierarchy_level: 1,
        account_item_name: null,
        account_category_name: "売上総損益金額",
        closing_balance: 600,
        composition_ratio: 60.0,
      }),
      row({
        hierarchy_level: 1,
        account_item_name: null,
        account_category_name: "営業損益金額",
        closing_balance: 200,
        composition_ratio: 20.0,
      }),
      row({
        hierarchy_level: 1,
        account_item_name: null,
        account_category_name: "経常損益金額",
        closing_balance: 210,
      }),
    ],
  };
}

function trialBsFixture(): FreeeTrialBalanceResponse {
  return {
    company_id: 1,
    fiscal_year: 2025,
    balances: [
      row({ hierarchy_level: 3, account_item_name: "売掛金", account_category_name: "売上債権", closing_balance: 500 }),
      row({ hierarchy_level: 3, account_item_name: "買掛金", account_category_name: "仕入債務", closing_balance: 300 }),
      row({ hierarchy_level: 3, account_item_name: "未払金", account_category_name: "他流動負債", closing_balance: 50 }),
      row({ hierarchy_level: 3, account_item_name: "短期借入金", account_category_name: "他流動負債", closing_balance: 100 }),
      row({ hierarchy_level: 3, account_item_name: "長期借入金", account_category_name: "固定負債", closing_balance: 400 }),
    ],
  };
}

afterEach(() => vi.restoreAllMocks());

describe("extractPlSummary", () => {
  it("reads the level-1 subtotal rows for revenue/gross profit/operating profit/ordinary profit", () => {
    const summary = extractPlSummary(trialPlFixture());
    expect(summary.revenue).toBe(1000);
    expect(summary.grossProfit).toBe(600);
    expect(summary.grossProfitRate).toBe(60.0);
    expect(summary.operatingProfit).toBe(200);
    expect(summary.operatingProfitRate).toBe(20.0);
    expect(summary.ordinaryProfit).toBe(210);
  });

  it("returns null (not 0) for a subtotal category that doesn't appear in the response", () => {
    const empty: FreeeTrialBalanceResponse = { company_id: 1, fiscal_year: 2025, balances: [] };
    const summary = extractPlSummary(empty);
    expect(summary.revenue).toBeNull();
    expect(summary.grossProfit).toBeNull();
  });

  it("does not mistake a level-2 leaf row sharing the same category name for the level-1 subtotal", () => {
    const trialPl = trialPlFixture();
    // 売上高のlevel=2行(leaf)とlevel=1行(subtotal)で値が異なるケースを模倣
    trialPl.balances[0].closing_balance = 999;
    const summary = extractPlSummary(trialPl);
    expect(summary.revenue).toBe(1000); // level=1の値を使う、level=2のleafではない
  });
});

describe("extractBsSummary", () => {
  it("reads accounts receivable as-is and sums payables/borrowings across multiple account items", () => {
    const summary = extractBsSummary(trialBsFixture());
    expect(summary.accountsReceivable).toBe(500);
    expect(summary.accountsPayable).toBe(350); // 買掛金300 + 未払金50
    expect(summary.borrowings).toBe(500); // 短期100 + 長期400（役員借入金は今回のfixtureに無し）
  });

  it("returns null when none of the target account items are found (never fabricates 0)", () => {
    const empty: FreeeTrialBalanceResponse = { company_id: 1, fiscal_year: 2025, balances: [] };
    const summary = extractBsSummary(empty);
    expect(summary.accountsReceivable).toBeNull();
    expect(summary.accountsPayable).toBeNull();
    expect(summary.borrowings).toBeNull();
  });
});

describe("sumCashAndDeposits", () => {
  it("sums walletable_balance across accounts, falling back to last_balance when balance is absent", () => {
    const walletables: FreeeWalletable[] = [
      { id: 1, name: "普通預金A", type: "bank_account", walletable_balance: 1000 },
      { id: 2, name: "普通預金B", type: "bank_account", last_balance: 500 },
    ];
    expect(sumCashAndDeposits(walletables)).toBe(1500);
  });

  it("returns null for an empty account list", () => {
    expect(sumCashAndDeposits([])).toBeNull();
  });
});
