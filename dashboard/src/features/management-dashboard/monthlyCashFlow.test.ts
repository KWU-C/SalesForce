import { afterEach, describe, expect, it, vi } from "vitest";
import { EXTERNAL_CASH_FLOW_CALCULATION_VERSION } from "./externalCashFlow";
import type { JournalGroup, JournalLine } from "./journalCsv";

const getTrialBsMock = vi.fn();
const getWalletTxnsMock = vi.fn();
const getAccountItemsMock = vi.fn();
const getWalletablesMock = vi.fn();
const getJournalsCsvMock = vi.fn();

vi.mock("@/services/freee/freeeAccountingClient", () => ({
  getTrialBs: getTrialBsMock,
}));
vi.mock("@/services/freee/freeeTransactionClient", () => ({
  getWalletTxns: getWalletTxnsMock,
  getAccountItems: getAccountItemsMock,
  getWalletables: getWalletablesMock,
}));
vi.mock("@/services/freee/freeeJournalsClient", () => ({
  getJournalsCsv: getJournalsCsvMock,
}));

const { computeMonthlyCashFlow } = await import("./monthlyCashFlow");
import { journalExportRange } from "./journalCsv";

afterEach(() => {
  vi.restoreAllMocks();
  getTrialBsMock.mockReset();
  getWalletTxnsMock.mockReset();
  getAccountItemsMock.mockReset();
  getWalletablesMock.mockReset();
  getJournalsCsvMock.mockReset();
});

const line = (account: string, amount: number, subAccount = "", memo = ""): JournalLine => ({
  account,
  subAccount,
  amount,
  memo,
});
const cash = (wallet: string, amount: number, memo = "") => line("現金及び預金", amount, wallet, memo);
const group = (date: string, debits: JournalLine[], credits: JournalLine[]): JournalGroup => ({ date, debits, credits });

function cashLeaf(name: string, opening: number, closing: number) {
  return {
    hierarchy_level: 3,
    account_item_name: name,
    account_category_name: "現金・預金",
    opening_balance: opening,
    closing_balance: closing,
    debit_amount: 0,
    credit_amount: 0,
    composition_ratio: 0,
  };
}

function setupCommonMocks(balances = [cashLeaf("普通預金A", 10_000, 10_000), cashLeaf("現金", 500, 500)]) {
  getAccountItemsMock.mockResolvedValue([
    { id: 1, name: "売掛金", account_category: "売上債権" },
    { id: 2, name: "給料手当", account_category: "販売管理費" },
    { id: 3, name: "業務委託費", account_category: "販売管理費" },
    { id: 4, name: "通信費", account_category: "販売管理費" },
    { id: 5, name: "長期借入金", account_category: "固定負債" },
    { id: 6, name: "支払利息", account_category: "営業外費用" },
    { id: 7, name: "保険積立金", account_category: "投資その他の資産" },
    { id: 8, name: "雑収入", account_category: "営業外収益" },
    { id: 9, name: "仮払金", account_category: "他流動資産" },
    { id: 10, name: "未払金", account_category: "他流動負債" },
    { id: 11, name: "租税公課", account_category: "販売管理費" },
    { id: 12, name: "預り金", account_category: "他流動負債" },
  ]);
  getWalletablesMock.mockResolvedValue([
    { id: 100, type: "bank_account", name: "普通預金A" },
    { id: 101, type: "bank_account", name: "普通預金B" },
    { id: 200, type: "credit_card", name: "カード" },
    { id: 5980023, type: "wallet", name: "現金" },
  ]);
  getTrialBsMock.mockResolvedValue({ company_id: 1, fiscal_year: 2025, balances });
  getWalletTxnsMock.mockResolvedValue([]);
  getJournalsCsvMock.mockResolvedValue("");
}

describe("journalExportRange", () => {
  it("covers the previous term's start through the target term's end (債務の原因科目を辿る根拠を含む)", () => {
    expect(journalExportRange(2025)).toEqual({ start: "2024-09-01", end: "2026-08-31" });
  });
});

describe("computeMonthlyCashFlow: 入出金v3(仕訳帳)", () => {
  it("computes キャッシュイン/キャッシュアウト from the journals of the target month only", async () => {
    setupCommonMocks();
    const groups = [
      group("2026-08-15", [cash("普通預金A", 500)], [line("売掛金", 500)]),
      group("2026-08-16", [line("給料手当", 300)], [cash("普通預金A", 300)]),
      group("2026-07-31", [cash("普通預金A", 9_999)], [line("売掛金", 9_999)]), // 前月
      group("2026-09-01", [line("給料手当", 8_888)], [cash("普通預金A", 8_888)]), // 翌月
    ];

    const r = await computeMonthlyCashFlow(1, 2025, 8, { journalGroups: groups });

    expect(r.externalIncome).toBe(500);
    expect(r.inflow?.operating).toBe(500);
    expect(r.externalExpenseTotal).toBe(300);
    expect(r.outflow?.labor).toBe(300);
  });

  it("uses journals outside the month as evidence for tracing a payable settlement (支払は前月の費用の精算)", async () => {
    setupCommonMocks();
    const groups = [
      group("2026-07-31", [line("業務委託費", 800)], [line("未払金", 800, "株式会社A")]),
      group("2026-08-20", [line("未払金", 800, "株式会社A")], [cash("普通預金A", 800)]),
    ];

    const r = await computeMonthlyCashFlow(1, 2025, 8, { journalGroups: groups });

    expect(r.outflow?.outsourcing).toBe(800);
    expect(r.outflow?.unclassified).toBe(0);
  });

  it("fetches the previous+current term's journals when none are passed", async () => {
    setupCommonMocks();

    await computeMonthlyCashFlow(1, 2025, 8);

    expect(getJournalsCsvMock).toHaveBeenCalledWith(1, "2024-09-01", "2026-08-31");
  });

  it("makes 月初現預金 + キャッシュイン − キャッシュアウト = 月末現預金 hold when the journals are complete", async () => {
    // 月初: 普通預金A 10,000 + 現金 500。入金700(売掛金)、出金: 給料手当300・現金払いの通信費50。口座↔現金の移動200は入出金に含めない
    setupCommonMocks([cashLeaf("普通預金A", 10_000, 10_000 + 700 - 300 - 200), cashLeaf("現金", 500, 500 + 200 - 50)]);
    const groups = [
      group("2026-08-05", [cash("普通預金A", 700)], [line("売掛金", 700)]),
      group("2026-08-06", [line("給料手当", 300)], [cash("普通預金A", 300)]),
      group("2026-08-07", [cash("現金", 200)], [cash("普通預金A", 200)]),
      group("2026-08-08", [line("通信費", 50)], [cash("現金", 50)]),
    ];

    const r = await computeMonthlyCashFlow(1, 2025, 8, { journalGroups: groups });

    expect(r.cashOpening).toBe(10_500);
    expect(r.cashClosing).toBe(10_500 + 700 - 350);
    expect(r.cashOpening! + r.externalIncome - r.externalExpenseTotal).toBe(r.cashClosing);
    expect(r.cashChange).toBe(r.externalIncome - r.externalExpenseTotal);
  });

  it("does NOT adjust a reconciliation gap: a journal missing from the export shows up as a nonzero difference", async () => {
    setupCommonMocks([cashLeaf("普通預金A", 10_000, 10_700), cashLeaf("現金", 500, 500)]);

    const r = await computeMonthlyCashFlow(1, 2025, 8, { journalGroups: [] });

    // 入出金0なのに預金が700増えている → 差額700をそのまま残す(「その他」等で埋めない)
    expect(r.cashChange).toBe(700);
    expect(r.cashChange! - (r.externalIncome - r.externalExpenseTotal)).toBe(700);
  });

  it("営業キャッシュ収支 = 営業入金 − 営業支出(人件費+外注費+税金社保+諸経費+その他); borrowing/insurance/other inflows and financing/interest/asset/unclassified outflows are excluded", async () => {
    setupCommonMocks();
    const groups = [
      // 入金: 営業1,000 / 借入5,000 / 保険等400 / その他30
      group("2026-08-02", [cash("普通預金A", 1_000)], [line("売掛金", 1_000)]),
      group("2026-08-02", [cash("普通預金A", 5_000)], [line("長期借入金", 5_000)]),
      group("2026-08-02", [cash("普通預金A", 400)], [line("保険積立金", 400)]),
      group("2026-08-02", [cash("普通預金A", 30)], [line("雑収入", 30)]),
      // 出金: 営業支出 人件費100・外注費200・税金40・諸経費10 / 元本600・利息70・積立90・未分類7
      group("2026-08-03", [line("給料手当", 100)], [cash("普通預金A", 100)]),
      group("2026-08-03", [line("業務委託費", 200)], [cash("普通預金A", 200)]),
      group("2026-08-03", [line("租税公課", 40)], [cash("普通預金A", 40)]),
      group("2026-08-03", [line("通信費", 10)], [cash("普通預金A", 10)]),
      group("2026-08-03", [line("長期借入金", 600)], [cash("普通預金A", 600)]),
      group("2026-08-03", [line("支払利息", 70)], [cash("普通預金A", 70)]),
      group("2026-08-03", [line("保険積立金", 90)], [cash("普通預金A", 90)]),
      group("2026-08-03", [line("仮払金", 7)], [cash("普通預金A", 7)]),
    ];

    const r = await computeMonthlyCashFlow(1, 2025, 8, { journalGroups: groups });

    expect(r.externalIncome).toBe(1_000 + 5_000 + 400 + 30);
    expect(r.externalExpenseTotal).toBe(100 + 200 + 40 + 10 + 600 + 70 + 90 + 7);
    expect(r.operatingCashFlow).toBe(1_000 - (100 + 200 + 40 + 10));
    expect(r.financingCashFlow).toBe(-600);
    expect(r.interestCashFlow).toBe(-70);
    expect(r.assetTransferCashFlow).toBe(-90);
    expect(r.outflow?.unclassified).toBe(7);
    expect(r.expenseByCategory.labor).toBe(100);
    expect(r.expenseByCategory.outsourcing).toBe(200);
    expect(r.expenseByCategory.taxSocial).toBe(40);
    expect(r.expenseByCategory.otherOperating).toBe(10);
    expect(r.expenseByCategory.other).toBe(0);
  });

  it("returns null cashOpening/cashClosing/cashChange (not 0) when no cash leaves are found in trial_bs", async () => {
    setupCommonMocks([]);

    const r = await computeMonthlyCashFlow(1, 2025, 8, { journalGroups: [] });

    expect(r.cashOpening).toBeNull();
    expect(r.cashClosing).toBeNull();
    expect(r.cashChange).toBeNull();
  });

  it("is provisional while 未分類 remains or evidence-backed adjustments apply, and final when clean", async () => {
    setupCommonMocks();
    const clean = [group("2026-08-02", [cash("普通預金A", 10)], [line("売掛金", 10)])];
    const withUnclassified = [group("2026-08-03", [line("仮払金", 7)], [cash("普通預金A", 7)])];

    expect((await computeMonthlyCashFlow(1, 2025, 8, { journalGroups: clean })).status).toBe("final");
    expect((await computeMonthlyCashFlow(1, 2025, 8, { journalGroups: withUnclassified })).status).toBe("provisional");

    getWalletTxnsMock.mockResolvedValue([
      { id: 2045158083, date: "2026-08-10", amount: 50_000_000, entry_side: "income", walletable_type: "bank_account", walletable_id: 4469148 },
    ]);
    getWalletablesMock.mockResolvedValue([
      { id: 100, type: "bank_account", name: "普通預金A" },
      { id: 4469148, type: "bank_account", name: "りそな" },
    ]);
    const tripResult = await computeMonthlyCashFlow(11314786, 2025, 8, { journalGroups: clean });
    expect(tripResult.status).toBe("provisional");
    expect(tripResult.inflow?.netZeroRoundTrip).toBe(50_000_000);
  });

  it("records the current calculation version", async () => {
    setupCommonMocks();

    const r = await computeMonthlyCashFlow(1, 2025, 8, { journalGroups: [] });

    expect(r.calculationVersion).toBe(EXTERNAL_CASH_FLOW_CALCULATION_VERSION);
  });
});
