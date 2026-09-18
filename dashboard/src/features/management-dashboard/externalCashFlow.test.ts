import { describe, expect, it } from "vitest";
import { computeExternalCashFlow, EXTERNAL_CASH_FLOW_CALCULATION_VERSION } from "./externalCashFlow";
import type { FreeeTransfer, FreeeWalletTxn } from "@/services/freee/freeeTransactionClient";

const OTHER_COMPANY_ID = 1; // externalCashFlowOverrides.tsのCOMPANY_ID(11314786)とは別の値であること

function income(id: number, date: string, amount: number, walletableId = 100): FreeeWalletTxn {
  return { id, date, amount, entry_side: "income", walletable_type: "bank_account", walletable_id: walletableId };
}

function expense(id: number, date: string, amount: number, walletableId = 100): FreeeWalletTxn {
  return { id, date, amount, entry_side: "expense", walletable_type: "bank_account", walletable_id: walletableId };
}

describe("computeExternalCashFlow", () => {
  it("reports the calculation version and marks a clean period as final", () => {
    const result = computeExternalCashFlow(OTHER_COMPANY_ID, [], [], []);
    expect(result.calculationVersion).toBe(EXTERNAL_CASH_FLOW_CALCULATION_VERSION);
    expect(result.status).toBe("final");
  });

  it("does not double-match two identical (date, walletable, amount) transfers against a single wallet_txn", () => {
    const cashIncome = [income(1, "2026-08-15", 1000)];
    const transfers: FreeeTransfer[] = [
      {
        id: 1,
        amount: 1000,
        date: "2026-08-15",
        from_walletable_type: "bank_account",
        from_walletable_id: 200,
        to_walletable_type: "bank_account",
        to_walletable_id: 100,
        to_walletables: [{ type: "bank_account", id: 100, amount: 1000 }],
      },
      {
        id: 2,
        amount: 1000,
        date: "2026-08-15",
        from_walletable_type: "bank_account",
        from_walletable_id: 200,
        to_walletable_type: "bank_account",
        to_walletable_id: 100,
        to_walletables: [{ type: "bank_account", id: 100, amount: 1000 }],
      },
    ];

    const result = computeExternalCashFlow(OTHER_COMPANY_ID, cashIncome, [], transfers);

    // wallet_txnは1件しかないので、1件しか消費されない(1:1消費マッチング)
    expect(result.officialTransferIncomeMatchCount).toBe(1);
    expect(result.externalIncome).toBe(0);
  });

  it("keeps an unmatched income txn as external income when no transfer/override applies", () => {
    const cashIncome = [income(1, "2026-08-15", 500)];
    const result = computeExternalCashFlow(OTHER_COMPANY_ID, cashIncome, [], []);
    expect(result.externalIncome).toBe(500);
    expect(result.status).toBe("final");
  });

  it("only nets the receiving leg's actual amount (fee-adjusted), never the face amount", () => {
    const cashIncome = [income(1, "2026-08-20", 416_790)];
    const transfers: FreeeTransfer[] = [
      {
        id: 1,
        amount: 417_450, // 送金元の額面(手数料込み)
        date: "2026-08-20",
        from_walletable_type: "wallet",
        from_walletable_id: 300,
        to_walletable_type: "bank_account",
        to_walletable_id: 100,
        to_walletables: [{ type: "bank_account", id: 100, amount: 416_790 }], // 受取実額
      },
    ];

    const result = computeExternalCashFlow(OTHER_COMPANY_ID, cashIncome, [], transfers);

    expect(result.officialTransferIncomeMatchTotal).toBe(416_790);
    expect(result.externalIncome).toBe(0);
  });

  it("does not remove a wallet_txn from the expense side just because the income side matched (asymmetric sides)", () => {
    const cashIncome = [income(1, "2026-08-15", 1000, 100)];
    const cashExpense = [expense(2, "2026-08-15", 1000, 999)]; // 別口座、対応する公式transferなし
    const transfers: FreeeTransfer[] = [
      {
        id: 1,
        amount: 1000,
        date: "2026-08-15",
        from_walletable_type: "bank_account",
        from_walletable_id: 200,
        to_walletable_type: "bank_account",
        to_walletable_id: 100,
        to_walletables: [{ type: "bank_account", id: 100, amount: 1000 }],
      },
    ];

    const result = computeExternalCashFlow(OTHER_COMPANY_ID, cashIncome, cashExpense, transfers);

    expect(result.externalIncome).toBe(0);
    expect(result.externalExpenseTotal).toBe(1000);
  });
});
