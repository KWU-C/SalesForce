import { describe, expect, it } from "vitest";
import type { FreeeTrialBalanceResponse, FreeeTrialBalanceRow } from "@/services/freee/freeeAccountingClient";
import type { FreeeAccountItem } from "@/services/freee/freeeTransactionClient";
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

function trialBsFixture(rows: FreeeTrialBalanceRow[]): FreeeTrialBalanceResponse {
  return { company_id: 1, fiscal_year: 2025, balances: rows };
}

const SAVINGS_ACCOUNT_ITEM: FreeeAccountItem = {
  id: 1013327727,
  name: "定期預金_尼信1012積立",
  walletable_id: 4582561,
};

describe("extractInsuranceAccountBalance", () => {
  it("reads the closing_balance of 保険積立金", () => {
    const trialBs = trialBsFixture([row({ account_item_name: "保険積立金", closing_balance: 300 })]);
    expect(extractInsuranceAccountBalance(trialBs)).toBe(300);
  });

  it("returns 0 (not null) when the row is entirely absent", () => {
    expect(extractInsuranceAccountBalance(trialBsFixture([]))).toBe(0);
  });
});

describe("buildFundReserve", () => {
  it("classifies purpose-mapped accounts generically via WALLETABLE_PURPOSE_MAP (id 4582561 = other), reading the selected month's closing_balance from trial_bs", () => {
    const trialBs = trialBsFixture([
      row({ account_item_name: "保険積立金", closing_balance: 300 }),
      row({
        account_item_name: "定期預金_尼信1012積立",
        account_category_name: "現金・預金",
        closing_balance: 500,
      }),
    ]);
    const reserve = buildFundReserve({ trialBs, accountItems: [SAVINGS_ACCOUNT_ITEM], cash: 2000 });

    expect(reserve.bonusReserveConfigured).toBe(false);
    expect(reserve.bonusReserve).toBe(0);
    expect(reserve.otherPurposeLines).toEqual([
      { label: "その他目的資金（定期預金_尼信1012積立）", balance: 500 },
    ]);
    expect(reserve.cashRestrictedTotal).toBe(500); // 保険積立金(300)は現金・預金カテゴリ外なので含めない
    expect(reserve.insuranceAssetReserve).toBe(300);
    expect(reserve.cash).toBe(2000);
    expect(reserve.freeCash).toBe(1500); // 2000 - 500 (保険積立金は控除しない、二重控除防止)
  });

  it("uses the selected month's trial_bs closing_balance, not a live/current balance (regression guard for the past-month staleness bug, 2026-09-15)", () => {
    // 過去月(例: 8月)表示時は、その月末時点の残高を返すべき。現在残高(例: 別の値)が
    // 混ざってはいけない
    const augustTrialBs = trialBsFixture([
      row({ account_item_name: "定期預金_尼信1012積立", account_category_name: "現金・預金", closing_balance: 4_500_000 }),
    ]);
    const reserve = buildFundReserve({ trialBs: augustTrialBs, accountItems: [SAVINGS_ACCOUNT_ITEM], cash: 100_000_000 });
    expect(reserve.otherPurposeLines).toEqual([
      { label: "その他目的資金（定期預金_尼信1012積立）", balance: 4_500_000 },
    ]);
    expect(reserve.cashRestrictedTotal).toBe(4_500_000);
  });

  it("does not subtract 保険積立金 from freeCash even when it is large (regression guard for the double-subtraction bug)", () => {
    // 実データ(2026-09-15)を模したケース: 現預金には保険積立金が一切含まれていないため、
    // freeCashの計算から保険積立金を除外しても現預金の全額はそのまま残るべき
    const trialBs = trialBsFixture([row({ account_item_name: "保険積立金", closing_balance: 19_567_068 })]);
    const reserve = buildFundReserve({ trialBs, accountItems: [], cash: 95_107_184 });

    expect(reserve.insuranceAssetReserve).toBe(19_567_068);
    expect(reserve.cashRestrictedTotal).toBe(0);
    expect(reserve.freeCash).toBe(95_107_184); // 保険積立金分を誤って引かない
  });

  it("keeps an other-purpose line's balance null (not 0) when no account_item maps to the walletable", () => {
    const reserve = buildFundReserve({ trialBs: trialBsFixture([]), accountItems: [], cash: 1000 });
    expect(reserve.otherPurposeLines).toEqual([
      { label: "その他目的資金（定期預金_尼信1012積立）", balance: null },
    ]);
    expect(reserve.cashRestrictedTotal).toBe(0); // nullは合計に0として寄与(未検出≠マイナス残高)
  });

  it("treats a missing trial_bs row as 0 (not null) once the account_item is found (freee omits zero-activity rows)", () => {
    const reserve = buildFundReserve({ trialBs: trialBsFixture([]), accountItems: [SAVINGS_ACCOUNT_ITEM], cash: 1000 });
    expect(reserve.otherPurposeLines).toEqual([
      { label: "その他目的資金（定期預金_尼信1012積立）", balance: 0 },
    ]);
  });

  it("returns null free cash when cash itself is unknown", () => {
    const trialBs = trialBsFixture([row({ account_item_name: "保険積立金", closing_balance: 100 })]);
    const reserve = buildFundReserve({ trialBs, accountItems: [], cash: null });
    expect(reserve.freeCash).toBeNull();
  });
});
