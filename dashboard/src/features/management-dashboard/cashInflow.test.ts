import { describe, expect, it } from "vitest";
import { EMPTY_INFLOW, sumInflows } from "./cashInflow";
import { computeJournalCashFlow } from "./journalCashFlow";
import type { JournalGroup, JournalLine } from "./journalCsv";
import type { FreeeAccountItem, FreeeWalletTxn, FreeeWalletable } from "@/services/freee/freeeTransactionClient";

const COMPANY = 11314786;

const WALLETABLES: FreeeWalletable[] = [
  { id: 4469147, type: "bank_account", name: "当座預金_三井住友" },
  { id: 4469149, type: "bank_account", name: "当座預金_尼信" },
  { id: 4469155, type: "bank_account", name: "定期預金_尼信" },
  { id: 5980023, type: "wallet", name: "現金" },
  { id: 7615514, type: "wallet", name: "受取手形・電子債権" },
];

const ACCOUNT_ITEMS: FreeeAccountItem[] = [
  { id: 1, name: "売掛金", account_category: "売上債権" },
  { id: 2, name: "受取手形", account_category: "売上債権" },
  { id: 3, name: "貸倒引当金(売)", account_category: "売上債権" },
  { id: 4, name: "売上高", account_category: "売上高" },
  { id: 5, name: "前受金", account_category: "他流動負債" },
  { id: 6, name: "長期借入金", account_category: "固定負債" },
  { id: 7, name: "保険積立金", account_category: "投資その他の資産" },
  { id: 8, name: "雑収入", account_category: "営業外収益" },
  { id: 9, name: "受取利息", account_category: "営業外収益" },
  { id: 10, name: "未収入金", account_category: "他流動資産" },
  { id: 11, name: "仮受金", account_category: "他流動負債" },
  { id: 12, name: "仮払金", account_category: "他流動資産" },
  { id: 13, name: "支払手数料", account_category: "販売管理費" },
  { id: 14, name: "仮払税金", account_category: "他流動資産" },
  { id: 15, name: "手形売却損", account_category: "営業外費用" },
  { id: 16, name: "保険料", account_category: "販売管理費" },
];

const SMBC = "当座預金_三井住友";
const AMAGASAKI = "当座預金_尼信";
const TERM_DEPOSIT = "定期預金_尼信";

const line = (account: string, amount: number, subAccount = "", memo = ""): JournalLine => ({
  account,
  subAccount,
  amount,
  memo,
});
const cash = (wallet: string, amount: number, memo = "") => line("現金及び預金", amount, wallet, memo);

function group(date: string, debits: JournalLine[], credits: JournalLine[]): JournalGroup {
  return { date, debits, credits };
}

function compute(groups: JournalGroup[], feedIncome: FreeeWalletTxn[] = []) {
  return computeJournalCashFlow({
    companyId: COMPANY,
    groups,
    walletables: WALLETABLES,
    accountItems: ACCOUNT_ITEMS,
    feedIncome,
    feedExpense: [],
  }).inflow;
}

describe("computeCashInflow: 区分", () => {
  it("classifies receipts against 売上債権 accounts (売掛金/受取手形/電子債権) as 営業入金", () => {
    const r = compute([
      group("2026-08-10", [cash(SMBC, 1000)], [line("売掛金", 1000)]),
      group("2026-08-11", [cash(AMAGASAKI, 400)], [line("受取手形", 400)]),
    ]);

    expect(r.operating).toBe(1400);
    expect(r.total).toBe(1400);
  });

  it("classifies by account category, so a new receivable-category account needs no code change; 貸倒引当金 is not an operating receipt", () => {
    const items: FreeeAccountItem[] = [...ACCOUNT_ITEMS, { id: 99, name: "新設の売掛科目", account_category: "売上債権" }];
    const r = computeJournalCashFlow({
      companyId: COMPANY,
      groups: [
        group("2026-08-10", [cash(SMBC, 300)], [line("新設の売掛科目", 300)]),
        group("2026-08-11", [cash(SMBC, 50)], [line("貸倒引当金(売)", 50)]),
      ],
      walletables: WALLETABLES,
      accountItems: items,
      feedIncome: [],
      feedExpense: [],
    }).inflow;

    expect(r.operating).toBe(300);
    expect(r.other).toBe(50);
  });

  it("classifies 借入(長期借入金)、保険積立金(保険・資産回収等)、雑収入・利息・未収入金(その他)", () => {
    const r = compute([
      group("2026-08-10", [cash(SMBC, 10_000)], [line("長期借入金", 10_000)]),
      group("2026-08-11", [cash(SMBC, 500)], [line("保険積立金", 500)]),
      group("2026-08-12", [cash(SMBC, 30)], [line("雑収入", 30)]),
      group("2026-08-13", [cash(SMBC, 20)], [line("受取利息", 20)]),
      group("2026-08-14", [cash(SMBC, 20_000)], [line("未収入金", 20_000)]),
    ]);

    expect(r.borrowing).toBe(10_000);
    expect(r.assetRecovery).toBe(500);
    expect(r.other).toBe(20_050);
    expect(r.total).toBe(30_550);
  });

  it("keeps a loan's net proceeds (借入額面−保証料等) as the actual cash received", () => {
    const r = compute([
      group(
        "2026-03-26",
        [cash(AMAGASAKI, 42_014_105), line("支払利息", 29_895), line("保険料", 1_956_000)],
        [line("長期借入金", 44_000_000)]
      ),
    ]);

    expect(r.borrowing).toBe(42_014_105);
  });

  it("puts suspense accounts (仮受金・仮払金) and unknown accounts into 未分類 with the counter accounts recorded, never into その他", () => {
    const r = compute([
      group("2026-06-30", [cash(SMBC, 6_735)], [line("仮受金", 6_735)]),
      group("2026-06-01", [cash(SMBC, 115_436)], [line("仮払金", 115_436)]),
      group("2026-06-02", [cash(SMBC, 77)], [line("見知らぬ科目", 77)]),
    ]);

    expect(r.unclassified).toBe(122_248);
    expect(r.other).toBe(0);
    expect(r.unclassifiedItems).toEqual([
      { date: "2026-06-30", amount: 6_735, accounts: ["仮受金"] },
      { date: "2026-06-01", amount: 115_436, accounts: ["仮払金"] },
      { date: "2026-06-02", amount: 77, accounts: ["見知らぬ科目"] },
    ]);
  });

  it("puts a cash receipt with no identifiable counter account into 未分類", () => {
    const r = compute([group("2026-08-10", [cash(SMBC, 900)], [])]);

    expect(r.unclassified).toBe(900);
  });

  it("splits one journal across categories by credit amounts when unrelated natures are mixed (売掛金+雑収入)", () => {
    const r = compute([
      group("2025-10-31", [cash(SMBC, 22_770), cash(SMBC, 44_000)], [line("売掛金", 22_770), line("雑収入", 44_000)]),
    ]);

    expect(r.operating).toBe(22_770);
    expect(r.other).toBe(44_000);
  });

  it("folds 雑収入 etc. into 保険・資産回収等 when the same receipt also releases 保険積立金 (1入金=1性質)", () => {
    const r = compute([
      group(
        "2025-11-28",
        [cash(SMBC, 33_119_000), line("雑損失", 262_484)],
        [line("雑収入", 13_409_150), line("保険積立金", 19_972_334)]
      ),
    ]);

    expect(r.assetRecovery).toBe(33_119_000);
    expect(r.other).toBe(0);
  });

  it("ignores compound-journal placeholder lines (複合) as counter accounts", () => {
    const r = compute([
      group(
        "2025-10-01",
        [cash(AMAGASAKI, 14_810_154), line("複合", 14_910_500), line("手形売却損", 99_246), line("支払手数料", 1_100)],
        [line("複合", 14_810_154), line("受取手形", 14_910_500), line("複合", 99_246), line("複合", 1_100)]
      ),
    ]);

    expect(r.operating).toBe(14_810_154);
    expect(r.unclassified).toBe(0);
  });
});

describe("computeCashInflow: 内部移動・境界", () => {
  it("does not count a cash→cash transfer between company accounts as inflow (内部移動)", () => {
    const r = compute([group("2025-09-18", [cash(SMBC, 20_000_000)], [cash(AMAGASAKI, 20_000_000)])]);

    expect(r.total).toBe(0);
    expect(r.internalTransfer).toBe(20_000_000);
  });

  it("splits a 定期預金 cancellation into internal principal and external interest inside one journal", () => {
    const r = compute([
      group(
        "2025-12-03",
        [cash(SMBC, 6_003_541), line("複合", 6_000_000), line("租税公課", 640), line("複合", 4_050), line("複合", 131)],
        [
          line("複合", 6_003_541),
          cash(TERM_DEPOSIT, 6_000_000),
          line("複合", 640),
          line("受取利息", 4_050),
          line("受取利息", 131),
        ]
      ),
    ]);

    expect(r.internalTransfer).toBe(6_000_000);
    expect(r.other).toBe(3_541);
    expect(r.total).toBe(3_541);
  });

  it("counts a receipt into the 現金 wallet (allow-listed as a cash equivalent) but not into the 受取手形・電子債権 wallet", () => {
    const r = compute([
      group("2026-08-10", [cash("現金", 5_000)], [line("売掛金", 5_000)]),
      group("2026-08-10", [cash("受取手形・電子債権", 700)], [line("売掛金", 700)]),
    ]);

    expect(r.operating).toBe(5_000);
    expect(r.total).toBe(5_000);
  });

  it("counts an electronic-receivable cash-in (資金化) once as 営業入金 at the bank, net of the deducted fee", () => {
    const r = compute([
      group("2026-06-22", [cash(AMAGASAKI, 3_010_040), line("支払手数料", 660)], [line("受取手形", 3_010_700)]),
    ]);

    expect(r.operating).toBe(3_010_040);
    expect(r.internalTransfer).toBe(0);
  });
});

describe("computeCashInflow: 入金時差引の純額化", () => {
  const receipt = group(
    "2026-08-26",
    [cash(SMBC, 900_000, "小林製薬（中国）有限公司 CR1 ｶﾞｲｺｸ ｶﾝｹｲ ﾋｼﾑｹｿｳｷﾝ4")],
    [line("売掛金", 900_000)]
  );
  const deduction = group(
    "2026-08-26",
    [line("仮払税金", 45_000), line("支払手数料", 2_500)],
    [cash(SMBC, 47_500, "小林製薬（中国）有限公司 【還付】中国税5％ ｶﾞｲｺｸ ｶﾝｹｲ ﾋｼﾑｹｿｳｷﾝ4")]
  );

  it("deducts a separately-booked at-source fee/withholding when the bank description (memo suffix) matches the same-day receipt", () => {
    const r = compute([receipt, deduction]);

    expect(r.operating).toBe(852_500);
    expect(r.atSourceDeductions).toBe(47_500);
  });

  it("does not deduct a same-day cash payment whose memo does not match the receipt's bank description", () => {
    const unrelated = group("2026-08-26", [line("支払手数料", 990)], [cash(SMBC, 990, "住民税納付手数料 ｾﾞｲｷﾝﾃｽｳﾘﾖｳｺｳｻﾞﾌﾘｶｴ")]);

    const r = compute([receipt, unrelated]);

    expect(r.operating).toBe(900_000);
    expect(r.atSourceDeductions).toBe(0);
  });

  it("does not deduct on a different day or from a different account even if the memo matches", () => {
    const otherDay = { ...deduction, date: "2026-08-27" };
    const otherAccount = group(
      "2026-08-26",
      [line("仮払税金", 45_000), line("支払手数料", 2_500)],
      [cash(AMAGASAKI, 47_500, "小林製薬（中国）有限公司 【還付】中国税5％ ｶﾞｲｺｸ ｶﾝｹｲ ﾋｼﾑｹｿｳｷﾝ4")]
    );

    expect(compute([receipt, otherDay]).atSourceDeductions).toBe(0);
    expect(compute([receipt, otherAccount]).atSourceDeductions).toBe(0);
  });

  it("does not deduct a cash-credit journal that has other debit accounts (e.g. a real expense payment)", () => {
    const expense = group(
      "2026-08-26",
      [line("支払手数料", 500), line("買掛金", 100)],
      [cash(SMBC, 600, "小林製薬（中国）有限公司 ｶﾞｲｺｸ ｶﾝｹｲ ﾋｼﾑｹｿｳｷﾝ4")]
    );

    expect(compute([receipt, expense]).atSourceDeductions).toBe(0);
  });
});

describe("computeCashInflow: 49期固有の証拠付き補完・除外", () => {
  it("marks the 3 operating receipts missing from the bank feed as 帳簿補完 (内数), only when the journal line exists", () => {
    const groups = [
      group("2025-09-10", [cash(AMAGASAKI, 407_825)], [line("受取手形", 407_825)]),
      group("2025-10-01", [cash(AMAGASAKI, 14_810_154)], [line("受取手形", 14_910_500)]),
    ];

    const r = compute(groups);

    expect(r.operating).toBe(15_217_979);
    expect(r.operatingLedgerOnly).toBe(15_217_979);
    expect(r.appliedEvidenceIds).toEqual([
      "term49-ledger-only-20250910-toyosu",
      "term49-ledger-only-20251001-kawaguchi",
    ]);
  });

  it("does not mark a same-amount receipt on another date/account as 帳簿補完", () => {
    const r = compute([group("2025-09-10", [cash(SMBC, 407_825)], [line("受取手形", 407_825)])]);

    expect(r.operating).toBe(407_825);
    expect(r.operatingLedgerOnly).toBe(0);
  });

  it("reports the 50,000,000 round trip as a reference item only when its income bank txn is in the period, and never adds it to the total", () => {
    const feed = [
      { id: 2045158083, date: "2025-10-31", amount: 50_000_000, entry_side: "income", walletable_type: "bank_account", walletable_id: 4469148 },
    ] satisfies FreeeWalletTxn[];

    const withTrip = compute([], feed);
    const withoutTrip = compute([], []);

    expect(withTrip.netZeroRoundTrip).toBe(50_000_000);
    expect(withTrip.total).toBe(0);
    expect(withTrip.appliedEvidenceIds).toEqual(["term49-net-zero-20251031-50000000"]);
    expect(withoutTrip.netZeroRoundTrip).toBe(0);
  });
});

describe("computeCashInflow: 規則B(入金として記帳された出金の訂正)", () => {
  const socialPayment = (amount: number) =>
    group("2026-06-01", [line("未払金", amount)], [cash(SMBC, amount, "CR1 646080535363308479ｺｳｻﾞﾌﾘｶｴ ｼﾔｶｲﾎｹﾝﾘﾖｳ")]);
  const correction = group(
    "2026-06-01",
    [cash(SMBC, 115_436, "646080535363308479ｺｳｻﾞﾌﾘｶｴ ｼﾔｶｲﾎｹﾝﾘﾖｳ"), line("[製]給料手当", 11_196)],
    [line("仮払金", 126_632)]
  );

  it("does not count an unclassifiable cash debit as inflow when a same-day, same-account payment shares its bank description (it corrects that outflow)", () => {
    const r = compute([socialPayment(1_000_000), socialPayment(999_043), correction]);

    expect(r.total).toBe(0);
    expect(r.unclassified).toBe(0);
    expect(r.reclassifiedAsOutflowCorrection).toBe(115_436);
  });

  it("keeps it as 未分類 inflow when no same-day payment shares its bank description", () => {
    const r = compute([correction]);

    expect(r.unclassified).toBe(115_436);
    expect(r.reclassifiedAsOutflowCorrection).toBe(0);
  });

  it("does not treat a classifiable inflow (e.g. 売掛金) as a correction even if a same-day payment shares the description", () => {
    const receipt = group("2026-06-01", [cash(SMBC, 500, "646080535363308479ｺｳｻﾞﾌﾘｶｴ ｼﾔｶｲﾎｹﾝﾘﾖｳ")], [line("売掛金", 500)]);

    const r = compute([socialPayment(1_000), receipt]);

    expect(r.operating).toBe(500);
    expect(r.reclassifiedAsOutflowCorrection).toBe(0);
  });
});

describe("sumInflows", () => {
  it("sums every field, so the term total is exactly the sum of its months", () => {
    const a = { ...EMPTY_INFLOW, operating: 100, other: 5, total: 105, appliedEvidenceIds: ["x"] };
    const b = {
      ...EMPTY_INFLOW,
      operating: 200,
      borrowing: 50,
      total: 250,
      operatingLedgerOnly: 30,
      unclassifiedItems: [{ date: "2026-06-01", amount: 1, accounts: ["仮払金"] }],
    };

    const sum = sumInflows([a, b]);

    expect(sum.operating).toBe(300);
    expect(sum.borrowing).toBe(50);
    expect(sum.other).toBe(5);
    expect(sum.total).toBe(355);
    expect(sum.operatingLedgerOnly).toBe(30);
    expect(sum.appliedEvidenceIds).toEqual(["x"]);
    expect(sum.unclassifiedItems).toHaveLength(1);
  });

  it("returns zeros for no months", () => {
    expect(sumInflows([]).total).toBe(0);
  });
});
