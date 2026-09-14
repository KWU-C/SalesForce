import { afterEach, describe, expect, it, vi } from "vitest";
import type { FreeeTrialBalanceResponse, FreeeTrialBalanceRow } from "@/services/freee/freeeAccountingClient";
import { extractMonthlyBs, extractMonthlyPl } from "./monthlyFinanceSnapshot";

function row(overrides: Partial<FreeeTrialBalanceRow>): FreeeTrialBalanceRow {
  return {
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

afterEach(() => vi.restoreAllMocks());

describe("extractMonthlyPl", () => {
  it("computes the single month's own value as closing - opening (freee's closing_balance is fiscal-year cumulative)", () => {
    const trialPl: FreeeTrialBalanceResponse = {
      company_id: 1,
      fiscal_year: 2025,
      balances: [
        // 8ヶ月累計900、9ヶ月累計1000 → 単月は100
        row({ total_line: true, account_category_name: "売上高", opening_balance: 900, closing_balance: 1000 }),
        row({ total_line: true, account_category_name: "売上総損益金額", opening_balance: 500, closing_balance: 560 }),
        row({ total_line: true, account_category_name: "営業損益金額", opening_balance: 100, closing_balance: 120 }),
        row({ total_line: true, account_category_name: "経常損益金額", opening_balance: 110, closing_balance: 125 }),
      ],
    };
    const summary = extractMonthlyPl(trialPl);
    expect(summary.sales).toBe(100);
    expect(summary.grossProfit).toBe(60);
    expect(summary.operatingProfit).toBe(20);
    expect(summary.ordinaryProfit).toBe(15);
  });

  it("computes grossMargin/operatingMargin as this month's own rate, not freee's cumulative composition_ratio", () => {
    const trialPl: FreeeTrialBalanceResponse = {
      company_id: 1,
      fiscal_year: 2025,
      balances: [
        row({
          total_line: true,
          account_category_name: "売上高",
          opening_balance: 0,
          closing_balance: 1000,
          composition_ratio: 999, // 累計ベースの値。単月率としては使わないことを確認する
        }),
        row({ total_line: true, account_category_name: "売上総損益金額", opening_balance: 0, closing_balance: 600 }),
        row({ total_line: true, account_category_name: "営業損益金額", opening_balance: 0, closing_balance: 200 }),
      ],
    };
    const summary = extractMonthlyPl(trialPl);
    expect(summary.grossMargin).toBe(60);
    expect(summary.operatingMargin).toBe(20);
  });

  it("classifies 販売管理費 leaf items into labor/outsourcing/otherSga per the config mapping", () => {
    const trialPl: FreeeTrialBalanceResponse = {
      company_id: 1,
      fiscal_year: 2025,
      balances: [
        row({ account_item_name: "給料手当", account_category_name: "販売管理費", opening_balance: 0, closing_balance: 300 }),
        row({ account_item_name: "法定福利費", account_category_name: "販売管理費", opening_balance: 0, closing_balance: 50 }),
        row({ account_item_name: "業務委託費", account_category_name: "販売管理費", opening_balance: 0, closing_balance: 80 }),
        row({ account_item_name: "旅費交通費", account_category_name: "販売管理費", opening_balance: 0, closing_balance: 20 }),
        // 販管費以外のleafは集計対象外
        row({ account_item_name: "給料手当", account_category_name: "労務費", opening_balance: 0, closing_balance: 9999 }),
      ],
    };
    const summary = extractMonthlyPl(trialPl);
    expect(summary.laborCost).toBe(350); // 給料手当300 + 法定福利費50
    expect(summary.outsourcingCost).toBe(80);
    expect(summary.otherSga).toBe(20);
  });

  it("returns null for labor/outsourcing/otherSga when no 販売管理費 rows exist at all", () => {
    const empty: FreeeTrialBalanceResponse = { company_id: 1, fiscal_year: 2025, balances: [] };
    const summary = extractMonthlyPl(empty);
    expect(summary.laborCost).toBeNull();
    expect(summary.outsourcingCost).toBeNull();
    expect(summary.otherSga).toBeNull();
  });
});

describe("extractMonthlyBs", () => {
  it("sums cash/deposit leaf accounts for opening/closing/change, and reads receivables/payables/borrowings", () => {
    const trialBs: FreeeTrialBalanceResponse = {
      company_id: 1,
      fiscal_year: 2025,
      balances: [
        row({ account_item_name: "現金", account_category_name: "現金・預金", opening_balance: 100, closing_balance: 150 }),
        row({ account_item_name: "普通預金A", account_category_name: "現金・預金", opening_balance: 900, closing_balance: 850 }),
        row({ account_item_name: "売掛金", account_category_name: "売上債権", closing_balance: 500 }),
        row({ account_item_name: "買掛金", account_category_name: "仕入債務", closing_balance: 300 }),
        row({ account_item_name: "未払金", account_category_name: "他流動負債", closing_balance: 50 }),
        row({ account_item_name: "短期借入金", account_category_name: "他流動負債", closing_balance: 100 }),
        row({ account_item_name: "長期借入金", account_category_name: "固定負債", closing_balance: 400 }),
      ],
    };
    const summary = extractMonthlyBs(trialBs);
    expect(summary.cashOpening).toBe(1000);
    expect(summary.cashClosing).toBe(1000);
    expect(summary.cashChange).toBe(0);
    expect(summary.accountsReceivable).toBe(500);
    expect(summary.accountsPayable).toBe(300);
    expect(summary.unpaidExpenses).toBe(50);
    expect(summary.borrowings).toBe(500); // 短期100 + 長期400
  });

  it("returns null (not 0) when nothing matches", () => {
    const empty: FreeeTrialBalanceResponse = { company_id: 1, fiscal_year: 2025, balances: [] };
    const summary = extractMonthlyBs(empty);
    expect(summary.cashOpening).toBeNull();
    expect(summary.cashClosing).toBeNull();
    expect(summary.cashChange).toBeNull();
    expect(summary.accountsReceivable).toBeNull();
    expect(summary.borrowings).toBeNull();
  });
});
