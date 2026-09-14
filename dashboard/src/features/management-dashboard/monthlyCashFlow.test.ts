import { afterEach, describe, expect, it, vi } from "vitest";

const getTrialBsMock = vi.fn();
const getWalletTxnsMock = vi.fn();
const getTransfersMock = vi.fn();
const getAccountItemsMock = vi.fn();
const getWalletablesMock = vi.fn();
const getExpenseDealsMock = vi.fn();

vi.mock("@/services/freee/freeeAccountingClient", () => ({
  getTrialBs: getTrialBsMock,
}));
vi.mock("@/services/freee/freeeTransactionClient", () => ({
  getWalletTxns: getWalletTxnsMock,
  getTransfers: getTransfersMock,
  getAccountItems: getAccountItemsMock,
  getWalletables: getWalletablesMock,
  getExpenseDeals: getExpenseDealsMock,
}));

const { computeMonthlyCashFlow } = await import("./monthlyCashFlow");

afterEach(() => {
  vi.restoreAllMocks();
  getTrialBsMock.mockReset();
  getWalletTxnsMock.mockReset();
  getTransfersMock.mockReset();
  getAccountItemsMock.mockReset();
  getWalletablesMock.mockReset();
  getExpenseDealsMock.mockReset();
});

function setupCommonMocks() {
  getAccountItemsMock.mockResolvedValue([
    { id: 1, name: "給料手当" },
    { id: 2, name: "業務委託費" },
    { id: 3, name: "長期借入金" },
    { id: 4, name: "保険積立金" },
    { id: 5, name: "通信費" },
    { id: 6, name: "預り金" },
  ]);
  getWalletablesMock.mockResolvedValue([
    { id: 100, type: "bank_account" },
    { id: 200, type: "credit_card" },
  ]);
  getTrialBsMock.mockResolvedValue({
    company_id: 1,
    fiscal_year: 2025,
    balances: [
      { hierarchy_level: 3, account_item_name: "現金", account_category_name: "現金・預金", opening_balance: 1000, closing_balance: 1200, debit_amount: 0, credit_amount: 0, composition_ratio: 0 },
    ],
  });
  getTransfersMock.mockResolvedValue([]);
}

describe("computeMonthlyCashFlow", () => {
  it("excludes credit_card wallet_txns and computes external income/expense net of transfers", async () => {
    setupCommonMocks();
    getWalletTxnsMock.mockResolvedValue([
      { id: 1, date: "2026-08-15", amount: 500, entry_side: "income", walletable_type: "bank_account", walletable_id: 100 },
      { id: 2, date: "2026-08-15", amount: 300, entry_side: "expense", walletable_type: "bank_account", walletable_id: 100 },
      { id: 3, date: "2026-08-16", amount: 9999, entry_side: "expense", walletable_type: "credit_card", walletable_id: 200 },
    ]);
    getExpenseDealsMock.mockResolvedValue([]);

    const result = await computeMonthlyCashFlow(1, 2025, 8);

    expect(result.externalIncome).toBe(500);
    expect(result.externalExpenseTotal).toBe(300);
  });

  it("subtracts inter-account transfer totals from both income and expense sides", async () => {
    setupCommonMocks();
    getWalletTxnsMock.mockResolvedValue([
      { id: 1, date: "2026-08-15", amount: 1000, entry_side: "income", walletable_type: "bank_account", walletable_id: 100 },
      { id: 2, date: "2026-08-15", amount: 1000, entry_side: "expense", walletable_type: "bank_account", walletable_id: 100 },
    ]);
    getTransfersMock.mockResolvedValue([{ id: 1, amount: 1000, date: "2026-08-15", from_walletable_id: 100, to_walletable_id: 101 }]);
    getExpenseDealsMock.mockResolvedValue([]);

    const result = await computeMonthlyCashFlow(1, 2025, 8);

    expect(result.externalIncome).toBe(0);
    expect(result.externalExpenseTotal).toBe(0);
  });

  it("classifies each deal by its largest detail line and only counts payments within the target month", async () => {
    setupCommonMocks();
    getWalletTxnsMock.mockResolvedValue([]);
    getExpenseDealsMock.mockResolvedValue([
      {
        id: 1,
        type: "expense",
        issue_date: "2026-08-20",
        details: [
          { account_item_id: 1, amount: 900 }, // 給料手当 (largest -> labor)
          { account_item_id: 6, amount: -100 }, // 預り金
        ],
        payments: [{ date: "2026-08-25", amount: 800, from_walletable_id: 100 }],
      },
      {
        id: 2,
        type: "expense",
        issue_date: "2026-05-01",
        details: [{ account_item_id: 2, amount: 500 }], // 業務委託費 -> outsourcing
        payments: [{ date: "2026-08-10", amount: 500, from_walletable_id: 100 }],
      },
      {
        id: 3,
        type: "expense",
        issue_date: "2026-08-01",
        details: [{ account_item_id: 5, amount: 300 }], // 通信費 -> otherOperating
        payments: [{ date: "2026-09-05", amount: 300, from_walletable_id: 100 }], // 対象月(8月)外なので除外
      },
    ]);

    const result = await computeMonthlyCashFlow(1, 2025, 8);

    expect(result.expenseByCategory.labor).toBe(800);
    expect(result.expenseByCategory.outsourcing).toBe(500);
    expect(result.expenseByCategory.otherOperating).toBe(0); // 9月決済分は含まれない
  });

  it("separates financing and asset-transfer cash flow from operating cash flow", async () => {
    setupCommonMocks();
    getWalletTxnsMock.mockResolvedValue([
      { id: 1, date: "2026-08-15", amount: 10000, entry_side: "income", walletable_type: "bank_account", walletable_id: 100 },
    ]);
    getExpenseDealsMock.mockResolvedValue([
      {
        id: 1,
        type: "expense",
        issue_date: "2026-08-01",
        details: [{ account_item_id: 3, amount: 2000 }], // 長期借入金 -> financing
        payments: [{ date: "2026-08-05", amount: 2000, from_walletable_id: 100 }],
      },
      {
        id: 2,
        type: "expense",
        issue_date: "2026-08-01",
        details: [{ account_item_id: 4, amount: 500 }], // 保険積立金 -> assetTransfer
        payments: [{ date: "2026-08-05", amount: 500, from_walletable_id: 100 }],
      },
      {
        id: 3,
        type: "expense",
        issue_date: "2026-08-01",
        details: [{ account_item_id: 1, amount: 1000 }], // 給料手当 -> labor (operating)
        payments: [{ date: "2026-08-05", amount: 1000, from_walletable_id: 100 }],
      },
    ]);

    const result = await computeMonthlyCashFlow(1, 2025, 8);

    expect(result.financingCashFlow).toBe(-2000);
    expect(result.assetTransferCashFlow).toBe(-500);
    // 営業CFは外部入金 - 通常運営区分(labor 1000のみ)。財務・積立は含めない
    expect(result.operatingCashFlow).toBe(10000 - 1000);
  });

  it("returns null cashOpening/cashClosing (not 0) when no cash leaves are found in trial_bs", async () => {
    setupCommonMocks();
    getTrialBsMock.mockResolvedValue({ company_id: 1, fiscal_year: 2025, balances: [] });
    getWalletTxnsMock.mockResolvedValue([]);
    getExpenseDealsMock.mockResolvedValue([]);

    const result = await computeMonthlyCashFlow(1, 2025, 8);

    expect(result.cashOpening).toBeNull();
    expect(result.cashClosing).toBeNull();
    expect(result.cashChange).toBeNull();
  });
});
