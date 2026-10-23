import { afterEach, describe, expect, it, vi } from "vitest";
import type { FreeeTrialBalanceResponse, FreeeTrialBalanceRow } from "@/services/freee/freeeAccountingClient";

const getTrialPlMock = vi.fn();
const getFreeeCompanyIdMock = vi.fn();

vi.mock("@/services/freee/freeeAccountingClient", () => ({
  getTrialPl: getTrialPlMock,
}));
vi.mock("@/repositories/freeeAuthRepository", () => ({
  getFreeeCompanyId: getFreeeCompanyIdMock,
}));

const { extractPlSummary, getFinancialSummary, profitRate } = await import("./financialSummary");

afterEach(() => {
  vi.restoreAllMocks();
  getTrialPlMock.mockReset();
  getFreeeCompanyIdMock.mockReset();
});

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

function trialPlFixture(): FreeeTrialBalanceResponse {
  return {
    company_id: 1,
    fiscal_year: 2025,
    balances: [
      row({ hierarchy_level: 2, account_item_name: "売上高", account_category_name: "売上高", closing_balance: 999 }),
      row({ hierarchy_level: 1, total_line: true, account_category_name: "売上高", closing_balance: 1000 }),
      row({
        hierarchy_level: 1,
        total_line: true,
        account_category_name: "売上総損益金額",
        closing_balance: 600,
        composition_ratio: 60.0,
      }),
      row({
        hierarchy_level: 1,
        total_line: true,
        account_category_name: "営業損益金額",
        closing_balance: 200,
        composition_ratio: 20.0,
      }),
      row({ hierarchy_level: 1, total_line: true, account_category_name: "経常損益金額", closing_balance: 210 }),
    ],
  };
}

describe("extractPlSummary", () => {
  it("reads the total_line subtotal rows for revenue/gross profit/operating profit/ordinary profit", () => {
    const summary = extractPlSummary(trialPlFixture());
    expect(summary.revenue).toBe(1000); // total_line:trueの行の値、leafの999ではない
    expect(summary.grossProfit).toBe(600);
    expect(summary.grossProfitRate).toBe(60.0);
    expect(summary.operatingProfit).toBe(200);
    expect(summary.operatingProfitRate).toBe(20.0);
    expect(summary.ordinaryProfit).toBe(210);
  });

  it("computes signed rates from the amounts instead of freee's unsigned composition_ratio", () => {
    const trialPl: FreeeTrialBalanceResponse = {
      company_id: 1,
      fiscal_year: 2026,
      balances: [
        row({ total_line: true, account_category_name: "売上高", closing_balance: 1000 }),
        // freeeのcomposition_ratioは損失でも正の値で返る
        row({ total_line: true, account_category_name: "売上総損益金額", closing_balance: -300, composition_ratio: 30 }),
        row({ total_line: true, account_category_name: "営業損益金額", closing_balance: -500, composition_ratio: 50 }),
      ],
    };
    const summary = extractPlSummary(trialPl);
    expect(summary.grossProfitRate).toBe(-30);
    expect(summary.operatingProfitRate).toBe(-50);
  });

  it("returns a null rate when revenue is 0 or missing", () => {
    expect(profitRate(100, 0)).toBeNull();
    expect(profitRate(100, null)).toBeNull();
    expect(profitRate(null, 1000)).toBeNull();
  });

  it("returns null (not 0) for a subtotal category that doesn't appear in the response", () => {
    const empty: FreeeTrialBalanceResponse = { company_id: 1, fiscal_year: 2025, balances: [] };
    const summary = extractPlSummary(empty);
    expect(summary.revenue).toBeNull();
    expect(summary.grossProfit).toBeNull();
  });

  it("does not match a same-named row that lacks total_line (regression guard for the undefined-vs-null bug)", () => {
    const trialPl: FreeeTrialBalanceResponse = {
      company_id: 1,
      fiscal_year: 2025,
      balances: [row({ hierarchy_level: 1, account_category_name: "売上総損益金額", closing_balance: 999 })],
    };
    const summary = extractPlSummary(trialPl);
    expect(summary.grossProfit).toBeNull();
  });
});

describe("getFinancialSummary", () => {
  it("passes the caller's fiscalYear through to getTrialPl explicitly (2026-09-18 regression guard: freeeのデフォルト当期判定は期切替直後に前期を指し続けることがある)", async () => {
    getFreeeCompanyIdMock.mockResolvedValue(11314786);
    getTrialPlMock.mockResolvedValue({ company_id: 11314786, fiscal_year: 2026, balances: [] });

    await getFinancialSummary(2026, 10);

    expect(getTrialPlMock).toHaveBeenCalledWith(11314786, expect.objectContaining({ fiscalYear: 2026 }));
  });

  it("limits the range to the term start (September) through the target month, so future-dated entries are excluded (2026-10-23)", async () => {
    getFreeeCompanyIdMock.mockResolvedValue(11314786);
    getTrialPlMock.mockResolvedValue({ company_id: 11314786, fiscal_year: 2026, balances: [] });

    await getFinancialSummary(2026, 10);
    await getFinancialSummary(2026, 3);
    await getFinancialSummary(2026, 9);

    expect(getTrialPlMock).toHaveBeenNthCalledWith(1, 11314786, { fiscalYear: 2026, startMonth: 9, endMonth: 10 });
    expect(getTrialPlMock).toHaveBeenNthCalledWith(2, 11314786, { fiscalYear: 2026, startMonth: 9, endMonth: 3 });
    expect(getTrialPlMock).toHaveBeenNthCalledWith(3, 11314786, { fiscalYear: 2026, startMonth: 9, endMonth: 9 });
  });

  it("returns null without calling getTrialPl when freee is not connected", async () => {
    getFreeeCompanyIdMock.mockResolvedValue(null);

    const result = await getFinancialSummary(2026, 10);

    expect(result).toBeNull();
    expect(getTrialPlMock).not.toHaveBeenCalled();
  });
});
