import { describe, expect, it } from "vitest";
import type { FreeeTrialBalanceResponse, FreeeTrialBalanceRow } from "@/services/freee/freeeAccountingClient";
import type { FreeeAccountItem } from "@/services/freee/freeeTransactionClient";
import {
  FUND_RESERVE_CALCULATION_VERSION,
  buildFundReserveCore,
  composeFundReserve,
  computeFundCapacity,
  extractInsuranceAccountBalance,
} from "./fundReserve";
import type { FundReserveCore } from "./fundReserve";
import { computeOverdraftStatus, extractLoanStatus } from "./loanStatus";
import { overdraftLimitTotal } from "./reserveSettings";
import type { ManagementReserveSettings } from "./reserveSettings";

function row(overrides: Partial<FreeeTrialBalanceRow>): FreeeTrialBalanceRow {
  return {
    hierarchy_level: 4,
    account_category_name: "投資その他の資産",
    opening_balance: 0,
    debit_amount: 0,
    credit_amount: 0,
    closing_balance: 0,
    composition_ratio: 0,
    ...overrides,
  };
}

function cashRow(name: string, closing: number): FreeeTrialBalanceRow {
  return row({ account_item_name: name, account_category_name: "現金・預金", closing_balance: closing });
}

function trialBsFixture(rows: FreeeTrialBalanceRow[]): FreeeTrialBalanceResponse {
  return { company_id: 1, fiscal_year: 2025, balances: rows };
}

// walletable_idはconfig/fundReserveClassification.tsの対象口座。金額はすべてダミー
const COLLATERAL_ITEM: FreeeAccountItem = { id: 1, name: "定期預金_担保", walletable_id: 4469155 };
const TAX_ITEM: FreeeAccountItem = { id: 2, name: "普通預金_納税", walletable_id: 4469154 };
const SAVINGS_ITEM: FreeeAccountItem = { id: 3, name: "定期預金_尼信1012積立", walletable_id: 4582561 };
const UNMAPPED_SAVINGS_ITEM: FreeeAccountItem = { id: 4, name: "定期預金_りそな", walletable_id: 4469156 };
const ALL_ITEMS = [COLLATERAL_ITEM, TAX_ITEM, SAVINGS_ITEM, UNMAPPED_SAVINGS_ITEM];

function settings(overrides: Partial<ManagementReserveSettings> = {}): ManagementReserveSettings {
  return {
    asOf: "2026-10-05",
    consumptionTaxReserve: 75,
    bonusReserve: 90,
    overdraftLimits: [
      { lender: "A", limit: 300 },
      { lender: "B", limit: 500 },
    ],
    source: "テスト",
    ...overrides,
  };
}

function coreFixture(overrides: Partial<FundReserveCore> = {}): FundReserveCore {
  return {
    calculationVersion: FUND_RESERVE_CALCULATION_VERSION,
    cashEarmarkLines: [],
    insuranceAssetReserve: 0,
    ...overrides,
  };
}

describe("extractInsuranceAccountBalance", () => {
  it("reads the closing_balance of 保険積立金", () => {
    const trialBs = trialBsFixture([row({ account_item_name: "保険積立金", closing_balance: 300 })]);
    expect(extractInsuranceAccountBalance(trialBs)).toBe(300);
  });

  it("returns 0 (not null) when the row is entirely absent", () => {
    expect(extractInsuranceAccountBalance(trialBsFixture([]))).toBe(0);
  });
});

describe("buildFundReserveCore", () => {
  it("lists each mapped account with the selected month's trial_bs closing_balance, in config order", () => {
    const trialBs = trialBsFixture([
      row({ account_item_name: "保険積立金", closing_balance: 300 }),
      cashRow("定期預金_担保", 3000),
      cashRow("普通預金_納税", 550),
      cashRow("定期預金_尼信1012積立", 500),
    ]);
    const core = buildFundReserveCore({ trialBs, accountItems: ALL_ITEMS });

    expect(core.calculationVersion).toBe(FUND_RESERVE_CALCULATION_VERSION);
    expect(core.cashEarmarkLines.map((l) => [l.purpose, l.balance])).toEqual([
      ["collateral", 3000],
      ["tax", 550],
      ["other", 500],
    ]);
    expect(core.insuranceAssetReserve).toBe(300);
  });

  it("does not pick up an account that is not in WALLETABLE_PURPOSE_MAP (りそな積立は用途確認まで対象外)", () => {
    const trialBs = trialBsFixture([cashRow("定期預金_りそな", 650)]);
    const core = buildFundReserveCore({ trialBs, accountItems: ALL_ITEMS });
    expect(core.cashEarmarkLines.reduce((sum, l) => sum + (l.balance ?? 0), 0)).toBe(0);
  });

  it("keeps a line's balance null (not 0) when no account_item maps to the walletable", () => {
    const core = buildFundReserveCore({ trialBs: trialBsFixture([]), accountItems: [] });
    expect(core.cashEarmarkLines.every((l) => l.balance === null)).toBe(true);
  });

  it("treats a missing trial_bs row as 0 once the account_item is found (freee omits zero-activity rows)", () => {
    const core = buildFundReserveCore({ trialBs: trialBsFixture([]), accountItems: [SAVINGS_ITEM] });
    expect(core.cashEarmarkLines.find((l) => l.purpose === "other")?.balance).toBe(0);
  });
});

describe("computeFundCapacity", () => {
  it("資金余力 = 現預金総額 − 当座貸越利用額 − 消費税準備 − 賞与準備", () => {
    const capacity = computeFundCapacity(1277, 800, settings());
    expect(capacity.overdraftUsed).toBe(800);
    expect(capacity.capacity).toBe(1277 - 800 - 75 - 90);
    expect(capacity.settingsAsOf).toBe("2026-10-05");
  });

  it("deducts the drawn amount, not the limit: 利用額60M・枠80Mなら60Mを控除し、空き枠は20M", () => {
    const limits = settings({
      consumptionTaxReserve: 7_500_000,
      bonusReserve: 9_000_000,
      overdraftLimits: [
        { lender: "A", limit: 30_000_000 },
        { lender: "B", limit: 50_000_000 },
      ],
    });
    const loanStatus = extractLoanStatus({
      company_id: 1,
      fiscal_year: 2025,
      balances: [
        row({ account_item_name: "短期借入金", account_category_name: "他流動負債", closing_balance: 60_000_000 }),
        row({ account_item_name: "長期借入金", account_category_name: "固定負債", closing_balance: 140_000_000 }),
      ],
    });
    const overdraft = computeOverdraftStatus(loanStatus, overdraftLimitTotal(limits));
    expect(overdraft).toEqual({ limitTotal: 80_000_000, used: 60_000_000, available: 20_000_000 });

    const reserve = composeFundReserve(coreFixture(), {
      cash: 120_000_000,
      settings: limits,
      loanTotal: loanStatus.totalCurrent,
      overdraftUsed: overdraft.used,
    });
    expect(reserve.capacity.overdraftUsed).toBe(60_000_000);
    expect(reserve.capacity.capacity).toBe(120_000_000 - 60_000_000 - 7_500_000 - 9_000_000);
    expect(reserve.netCash).toBe(120_000_000 - 200_000_000);
  });

  it("does not depend on the overdraft limit setting at all (limit missing, drawn amount known)", () => {
    const capacity = computeFundCapacity(1277, 600, settings({ overdraftLimits: [] }));
    expect(capacity.capacity).toBe(1277 - 600 - 75 - 90);
  });

  it("is null when there are no settings at all (no partial deduction), still reporting the drawn amount", () => {
    const capacity = computeFundCapacity(1277, 800, null);
    expect(capacity).toMatchObject({
      overdraftUsed: 800,
      consumptionTaxReserve: null,
      bonusReserve: null,
      capacity: null,
      settingsAsOf: null,
    });
  });

  it.each([
    ["消費税準備", { consumptionTaxReserve: null }],
    ["賞与準備", { bonusReserve: null }],
  ])("is null when only %s is missing", (_label, override) => {
    expect(computeFundCapacity(1277, 800, settings(override)).capacity).toBeNull();
  });

  it("is null when the drawn amount is unknown (loan status not available)", () => {
    expect(computeFundCapacity(1277, null, settings()).capacity).toBeNull();
  });

  it("is null when cash is unknown", () => {
    expect(computeFundCapacity(null, 800, settings()).capacity).toBeNull();
  });

  it("can go negative (shown as is)", () => {
    expect(computeFundCapacity(100, 800, settings()).capacity).toBe(100 - 800 - 75 - 90);
  });
});

describe("composeFundReserve", () => {
  const core = coreFixture({
    cashEarmarkLines: [
      { purpose: "collateral", label: "担保", balance: 3000 },
      { purpose: "tax", label: "納税", balance: 550 },
      { purpose: "other", label: "その他", balance: null },
    ],
    insuranceAssetReserve: 1960,
  });

  it("splits total cash into the earmarked accounts and the rest (a null line counts as 0)", () => {
    const reserve = composeFundReserve(core, { cash: 12775, settings: null, loanTotal: null, overdraftUsed: null });
    expect(reserve.unearmarkedCash).toBe(12775 - 3000 - 550);
  });

  it("ネットキャッシュ = 現預金総額 − 借入残高 (目的資金・準備額・保険積立金は引かない)", () => {
    const reserve = composeFundReserve(core, { cash: 12775, settings: settings(), loanTotal: 22661, overdraftUsed: 800 });
    expect(reserve.netCash).toBe(12775 - 22661);
  });

  it("does not let 保険積立金 affect 資金余力 or ネットキャッシュ", () => {
    const inputs = { cash: 12775, settings: settings(), loanTotal: 22661, overdraftUsed: 800 };
    const withInsurance = composeFundReserve(core, inputs);
    const withoutInsurance = composeFundReserve({ ...core, insuranceAssetReserve: 0 }, inputs);
    expect(withInsurance.capacity.capacity).toBe(withoutInsurance.capacity.capacity);
    expect(withInsurance.netCash).toBe(withoutInsurance.netCash);
  });

  it("does not use the earmarked account balances in 資金余力 (no double deduction of the tax account)", () => {
    const reserve = composeFundReserve(core, { cash: 12775, settings: settings(), loanTotal: null, overdraftUsed: 800 });
    expect(reserve.capacity.capacity).toBe(12775 - 800 - 75 - 90);
  });

  it("returns null for cash-derived figures when cash itself is unknown", () => {
    const reserve = composeFundReserve(core, { cash: null, settings: settings(), loanTotal: 22661, overdraftUsed: 800 });
    expect(reserve.unearmarkedCash).toBeNull();
    expect(reserve.capacity.capacity).toBeNull();
    expect(reserve.netCash).toBeNull();
  });

  it("returns null ネットキャッシュ when the loan total is unknown", () => {
    expect(composeFundReserve(core, { cash: 12775, settings: null, loanTotal: null, overdraftUsed: null }).netCash).toBeNull();
  });
});
