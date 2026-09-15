import { describe, expect, it } from "vitest";
import type { FreeeTrialBalanceResponse, FreeeTrialBalanceRow, FreeeWalletable } from "@/services/freee/freeeAccountingClient";
import { buildFundReserve, extractInsuranceAccountBalance } from "./fundReserve";

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

function trialBsFixture(insuranceClosing: number | undefined): FreeeTrialBalanceResponse {
  return {
    company_id: 1,
    fiscal_year: 2025,
    balances:
      insuranceClosing === undefined
        ? []
        : [row({ account_item_name: "保険積立金", closing_balance: insuranceClosing })],
  };
}

describe("extractInsuranceAccountBalance", () => {
  it("reads the closing_balance of 保険積立金", () => {
    expect(extractInsuranceAccountBalance(trialBsFixture(300))).toBe(300);
  });

  it("returns 0 (not null) when the row is entirely absent", () => {
    expect(extractInsuranceAccountBalance(trialBsFixture(undefined))).toBe(0);
  });
});

describe("buildFundReserve", () => {
  it("classifies purpose-mapped walletables generically via WALLETABLE_PURPOSE_MAP (id 4582561 = other)", () => {
    const walletables: FreeeWalletable[] = [
      { id: 4582561, name: "定期預金_尼信1012積立", type: "bank_account", walletable_balance: 500 },
    ];
    const reserve = buildFundReserve({ trialBs: trialBsFixture(300), walletables, cash: 2000 });

    expect(reserve.bonusReserveConfigured).toBe(false);
    expect(reserve.bonusReserve).toBe(0);
    expect(reserve.insuranceReserve).toBe(300);
    expect(reserve.otherPurposeLines).toEqual([
      { label: "その他目的資金（定期預金_尼信1012積立）", balance: 500 },
    ]);
    expect(reserve.purposeReserveTotal).toBe(800); // bonus0 + insurance300 + other500
    expect(reserve.cash).toBe(2000);
    expect(reserve.freeCash).toBe(1200); // 2000 - 800
  });

  it("keeps an other-purpose line's balance null (not 0) when the walletable is missing from the response", () => {
    const reserve = buildFundReserve({ trialBs: trialBsFixture(0), walletables: [], cash: 1000 });
    expect(reserve.otherPurposeLines).toEqual([
      { label: "その他目的資金（定期預金_尼信1012積立）", balance: null },
    ]);
    expect(reserve.purposeReserveTotal).toBe(0); // nullは合計に0として寄与(未検出≠マイナス残高)
  });

  it("returns null free cash when cash itself is unknown", () => {
    const reserve = buildFundReserve({ trialBs: trialBsFixture(100), walletables: [], cash: null });
    expect(reserve.freeCash).toBeNull();
  });
});
