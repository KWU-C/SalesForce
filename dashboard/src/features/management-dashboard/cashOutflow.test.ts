import { describe, expect, it } from "vitest";
import { EMPTY_OUTFLOW, employeeSalarySubtotal, sumLaborDetails, sumOutflows } from "./cashOutflow";
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
  { id: 2, name: "給料手当", account_category: "販売管理費" },
  { id: 3, name: "[製]給料手当", account_category: "労務費" },
  { id: 4, name: "[製]賞与", account_category: "労務費" },
  { id: 5, name: "業務委託費", account_category: "販売管理費" },
  { id: 6, name: "預り金", account_category: "他流動負債" },
  { id: 7, name: "租税公課", account_category: "販売管理費" },
  { id: 8, name: "通信費", account_category: "販売管理費" },
  { id: 9, name: "長期借入金", account_category: "固定負債" },
  { id: 10, name: "支払利息", account_category: "営業外費用" },
  { id: 11, name: "保険積立金", account_category: "投資その他の資産" },
  { id: 12, name: "雑損失", account_category: "営業外費用" },
  { id: 13, name: "立替金", account_category: "他流動資産" },
  { id: 14, name: "仮払金", account_category: "他流動資産" },
  { id: 15, name: "未払金", account_category: "他流動負債" },
  { id: 16, name: "買掛金", account_category: "仕入債務" },
  { id: 17, name: "雑収入", account_category: "営業外収益" },
  { id: 18, name: "支払手数料", account_category: "販売管理費" },
  { id: 19, name: "仮払税金", account_category: "他流動資産" },
  { id: 20, name: "手形売却損", account_category: "営業外費用" },
  { id: 21, name: "車両費", account_category: "販売管理費" },
  { id: 22, name: "特殊な経費", account_category: "販売管理費" },
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
const group = (date: string, debits: JournalLine[], credits: JournalLine[]): JournalGroup => ({ date, debits, credits });

function compute(
  groups: JournalGroup[],
  options: { evidenceGroups?: JournalGroup[]; feedExpense?: FreeeWalletTxn[] } = {}
) {
  return computeJournalCashFlow({
    companyId: COMPANY,
    groups,
    evidenceGroups: options.evidenceGroups,
    walletables: WALLETABLES,
    accountItems: ACCOUNT_ITEMS,
    feedIncome: [],
    feedExpense: options.feedExpense ?? [],
  }).outflow;
}

describe("computeJournalCashFlow: 出金の区分(借方科目)", () => {
  it("classifies direct expense debits into 人件費/外注費/税金社保/諸経費/その他/借入元本/利息/積立資産移動", () => {
    const r = compute([
      group("2026-08-10", [line("給料手当", 1_000)], [cash(SMBC, 1_000)]),
      group("2026-08-10", [line("業務委託費", 2_000)], [cash(SMBC, 2_000)]),
      group("2026-08-10", [line("租税公課", 300)], [cash(SMBC, 300)]),
      group("2026-08-10", [line("預り金", 40)], [cash(SMBC, 40)]),
      group("2026-08-10", [line("通信費", 50)], [cash(SMBC, 50)]),
      group("2026-08-10", [line("特殊な経費", 6)], [cash(SMBC, 6)]),
      group("2026-08-10", [line("長期借入金", 700)], [cash(AMAGASAKI, 700)]),
      group("2026-08-10", [line("支払利息", 80)], [cash(AMAGASAKI, 80)]),
      group("2026-08-10", [line("保険積立金", 900)], [cash(SMBC, 900)]),
    ]);

    expect(r.labor).toBe(1_000);
    expect(r.outsourcing).toBe(2_000);
    expect(r.taxSocial).toBe(340);
    expect(r.otherOperating).toBe(50);
    expect(r.other).toBe(6);
    expect(r.financing).toBe(700);
    expect(r.interest).toBe(80);
    expect(r.assetTransfer).toBe(900);
    expect(r.unclassified).toBe(0);
    expect(r.total).toBe(1_000 + 2_000 + 340 + 50 + 6 + 700 + 80 + 900);
  });

  it("treats a 製造原価版科目([製]賞与)like its ordinary counterpart, not as その他", () => {
    const r = compute([group("2026-08-10", [line("[製]賞与", 500)], [cash(SMBC, 500)])]);

    expect(r.labor).toBe(500);
    expect(r.other).toBe(0);
  });

  it("puts balance-sheet debit accounts (立替金・仮払金) into 未分類 with the reason recorded, never into その他", () => {
    const r = compute([
      group("2026-04-30", [line("仮払金", 126_632)], [cash(SMBC, 126_632)]),
      group("2026-04-30", [line("立替金", 60)], [cash(SMBC, 60)]),
    ]);

    expect(r.unclassified).toBe(126_692);
    expect(r.other).toBe(0);
    expect(r.unclassifiedItems).toEqual([
      { date: "2026-04-30", amount: 126_632, reason: "balance_sheet_account", account: "仮払金" },
      { date: "2026-04-30", amount: 60, reason: "balance_sheet_account", account: "立替金" },
    ]);
  });

  it("scales the debit categories to the actual cash paid when the journal also credits withholding (総額/純額): cash out is exact", () => {
    // 給与 1,000 + 通信費 100 を計上し、預り金(源泉)100を差し引いて現金1,000を支払った伝票
    const r = compute([
      group("2026-08-25", [line("給料手当", 1_000), line("通信費", 100)], [cash(SMBC, 1_000), line("預り金", 100)]),
    ]);

    expect(r.total).toBe(1_000);
    expect(r.labor + r.otherOperating).toBe(1_000);
    expect(r.labor).toBe(909);
    expect(r.otherOperating).toBe(91);
  });

  it("ignores the compound placeholder (複合) as a debit account and classifies by the real debit lines", () => {
    const r = compute([
      group(
        "2025-10-01",
        [line("複合", 100), line("給料手当", 100)],
        [cash(SMBC, 100), line("複合", 100)]
      ),
    ]);

    expect(r.labor).toBe(100);
  });

  it("classifies an outflow with no debit account at all as 未分類", () => {
    const r = compute([group("2026-08-10", [], [cash(SMBC, 900)])]);

    expect(r.unclassified).toBe(900);
    expect(r.unclassifiedItems[0].reason).toBe("no_debit_account");
  });
});

describe("computeJournalCashFlow: 債務(未払金・買掛金)の精算", () => {
  const accrual = (partner: string, expense: string, amount: number, payable = "買掛金") =>
    group("2026-07-31", [line(expense, amount)], [line(payable, amount, partner)]);
  const payment = (partner: string, amount: number, memo = "", payable = "買掛金") =>
    group("2026-08-20", [line(payable, amount, partner, memo)], [cash(SMBC, amount, memo)]);

  it("traces a settlement to the expense accounts of the same partner's accrual journals (仕訳科目による判定)", () => {
    const evidence = [accrual("株式会社A", "業務委託費", 800), accrual("株式会社A", "通信費", 200)];

    const r = compute([payment("株式会社A", 1_000)], { evidenceGroups: evidence });

    expect(r.outsourcing).toBe(800);
    expect(r.otherOperating).toBe(200);
    expect(r.payableTraced).toBe(1_000);
    expect(r.payableByMemoRule).toBe(0);
  });

  it("uses accrual journals outside the target period (evidenceGroups), because settlements pay for earlier months", () => {
    const groups = [payment("株式会社A", 500)];

    const withEvidence = compute(groups, { evidenceGroups: [accrual("株式会社A", "業務委託費", 500)] });
    const withoutEvidence = compute(groups);

    expect(withEvidence.outsourcing).toBe(500);
    expect(withoutEvidence.unclassified).toBe(500);
    expect(withoutEvidence.unclassifiedItems[0].reason).toBe("payable_untraceable");
  });

  it("leaves a settlement to a partner with no accrual evidence as 未分類 (前期以前に発生した債務)", () => {
    const r = compute([payment("株式会社B", 2_000_000)]);

    expect(r.unclassified).toBe(2_000_000);
    expect(r.unclassifiedItems).toEqual([
      { date: "2026-08-20", amount: 2_000_000, reason: "payable_untraceable", account: "買掛金" },
    ]);
  });

  it("does not use a payment journal as accrual evidence", () => {
    const paymentJournal = payment("株式会社C", 700);

    const r = compute([payment("株式会社C", 700)], { evidenceGroups: [paymentJournal] });

    expect(r.unclassified).toBe(700);
  });

  it("uses the memo rule for 社会保険料 only as an auxiliary judgement when the partner can't be traced", () => {
    const r = compute([
      payment("", 5_000, "CR2 646080535363308479ｺｳｻﾞﾌﾘｶｴ ｼﾔｶｲﾎｹﾝﾘﾖｳ", "未払金"),
    ]);

    expect(r.taxSocial).toBe(5_000);
    expect(r.payableByMemoRule).toBe(5_000);
    expect(r.payableTraced).toBe(0);
  });

  it("prefers the journal-account trace over the memo rule when the partner has accrual evidence", () => {
    const evidence = [accrual("株式会社D", "通信費", 300, "未払金")];

    const r = compute([payment("株式会社D", 300, "社会保険料の件", "未払金")], { evidenceGroups: evidence });

    expect(r.otherOperating).toBe(300);
    expect(r.taxSocial).toBe(0);
    expect(r.payableTraced).toBe(300);
  });

  it("classifies a payroll transfer (部門タグ+ﾌﾘｺﾐ, blank partner) as 人件費 by the memo rule", () => {
    const r = compute([payment("", 4_000, "CR1 ﾌﾘｺﾐ", "未払金"), payment("", 1_000, "取締役 ﾌﾘｺﾐ", "未払金")]);

    expect(r.labor).toBe(5_000);
    expect(r.payableByMemoRule).toBe(5_000);
  });

  it("does NOT use a pooled mix for a blank partner: a blank-partner settlement with no matching memo rule is 未分類", () => {
    // 補助科目が空欄の未払金の発生が別にあっても、個別の支払の根拠にならない
    const evidence = [accrual("", "給料手当", 10_000, "未払金")];

    const r = compute([payment("", 700, "ﾌﾘｺﾐ", "未払金")], { evidenceGroups: evidence });

    expect(r.unclassified).toBe(700);
  });
});

describe("computeJournalCashFlow: 内部移動・総額/純額・境界", () => {
  it("does not count a cash→cash transfer as outflow, and it is symmetric with the inflow side", () => {
    const g = group("2025-09-18", [cash(SMBC, 20_000_000)], [cash(AMAGASAKI, 20_000_000)]);

    const both = computeJournalCashFlow({
      companyId: COMPANY,
      groups: [g],
      walletables: WALLETABLES,
      accountItems: ACCOUNT_ITEMS,
      feedIncome: [],
      feedExpense: [],
    });

    expect(both.outflow.total).toBe(0);
    expect(both.outflow.internalTransfer).toBe(20_000_000);
    expect(both.inflow.internalTransfer).toBe(20_000_000);
  });

  it("splits a transfer with a fee in one journal: the transfer is internal, the fee is an external 諸経費", () => {
    const r = compute([
      group(
        "2025-09-05",
        [cash(SMBC, 2_000_000), line("支払手数料", 440)],
        [cash(AMAGASAKI, 2_000_000), cash(AMAGASAKI, 440)]
      ),
    ]);

    expect(r.internalTransfer).toBe(2_000_000);
    expect(r.otherOperating).toBe(440);
    expect(r.total).toBe(440);
  });

  it("treats a withdrawal to the 現金 wallet as internal and petty-cash spending as an external outflow (現金 is inside the boundary)", () => {
    const r = compute([
      group("2026-08-10", [cash("現金", 300_000)], [cash(SMBC, 300_000)]),
      group("2026-08-11", [line("通信費", 4_000)], [cash("現金", 4_000)]),
    ]);

    expect(r.internalTransfer).toBe(300_000);
    expect(r.otherOperating).toBe(4_000);
    expect(r.total).toBe(4_000);
  });

  it("does not count a payment from a wallet outside the boundary (受取手形・電子債権)", () => {
    const r = compute([group("2026-08-10", [line("通信費", 999)], [cash("受取手形・電子債権", 999)])]);

    expect(r.total).toBe(0);
  });

  it("excludes an at-source deduction journal (already netted out of 営業入金) from the outflow, so it is never counted twice", () => {
    const receipt = group(
      "2026-08-26",
      [cash(SMBC, 900_000, "小林製薬（中国）有限公司 ｶﾞｲｺｸ ｶﾝｹｲ ﾋｼﾑｹｿｳｷﾝ4")],
      [line("売掛金", 900_000)]
    );
    const deduction = group(
      "2026-08-26",
      [line("仮払税金", 45_000), line("支払手数料", 2_500)],
      [cash(SMBC, 47_500, "小林製薬（中国）有限公司 【還付】中国税5％ ｶﾞｲｺｸ ｶﾝｹｲ ﾋｼﾑｹｿｳｷﾝ4")]
    );

    const r = computeJournalCashFlow({
      companyId: COMPANY,
      groups: [receipt, deduction],
      walletables: WALLETABLES,
      accountItems: ACCOUNT_ITEMS,
      feedIncome: [],
      feedExpense: [],
    });

    expect(r.inflow.operating).toBe(852_500);
    expect(r.outflow.total).toBe(0);
    expect(r.outflow.atSourceDeductionsExcluded).toBe(47_500);
  });

  it("nets a booked-as-inflow correction against the matching same-day payments (総額/純額: 6/1の社会保険料)", () => {
    const social = (amount: number) =>
      group("2026-06-01", [line("未払金", amount, "", "CR1 646080535363308479ｺｳｻﾞﾌﾘｶｴ ｼﾔｶｲﾎｹﾝﾘﾖｳ")], [
        cash(SMBC, amount, "CR1 646080535363308479ｺｳｻﾞﾌﾘｶｴ ｼﾔｶｲﾎｹﾝﾘﾖｳ"),
      ]);
    const correction = group(
      "2026-06-01",
      [cash(SMBC, 115_436, "646080535363308479ｺｳｻﾞﾌﾘｶｴ ｼﾔｶｲﾎｹﾝﾘﾖｳ"), line("[製]給料手当", 11_196)],
      [line("仮払金", 126_632)]
    );

    const r = computeJournalCashFlow({
      companyId: COMPANY,
      groups: [social(3_000_000), social(2_999_043), correction],
      walletables: WALLETABLES,
      accountItems: ACCOUNT_ITEMS,
      feedIncome: [],
      feedExpense: [],
    });

    // 銀行の実際の引落5,883,607円 = 記帳の合計5,999,043円 − 訂正115,436円
    expect(r.outflow.taxSocial).toBe(5_883_607);
    expect(r.outflow.total).toBe(5_883_607);
    expect(r.outflow.outflowCorrections).toBe(115_436);
    expect(r.inflow.total).toBe(0);
  });
});

describe("computeJournalCashFlow: 49期固有の参考情報", () => {
  it("marks the external outflow on accounts/periods without a bank feed as 帳簿補完 (内数)", () => {
    const beforeFeed = group("2025-10-10", [line("長期借入金", 2_227_000), line("支払利息", 145_034)], [cash(AMAGASAKI, 2_372_034)]);
    const afterFeed = group("2025-11-10", [line("通信費", 1_000)], [cash(AMAGASAKI, 1_000)]);

    const r = compute([beforeFeed, afterFeed]);

    expect(r.total).toBe(2_373_034);
    expect(r.ledgerOnly).toBe(2_372_034);
  });

  it("reports the 50,000,000 round trip's expense leg as a reference item only when that bank txn is in the period; it is never in the total", () => {
    const feedExpense = [
      { id: 2045158085, date: "2025-10-31", amount: 50_000_000, entry_side: "expense", walletable_type: "bank_account", walletable_id: 4469148 },
    ] satisfies FreeeWalletTxn[];

    const withTrip = compute([], { feedExpense });
    const withoutTrip = compute([]);

    expect(withTrip.netZeroRoundTrip).toBe(50_000_000);
    expect(withTrip.total).toBe(0);
    expect(withTrip.appliedEvidenceIds).toEqual(["term49-net-zero-20251031-50000000"]);
    expect(withoutTrip.netZeroRoundTrip).toBe(0);
  });

  it("counts a term-deposit interest-free principal transfer as internal, not outflow", () => {
    const r = compute([group("2025-10-31", [cash(TERM_DEPOSIT, 500_000)], [cash(SMBC, 500_000)])]);

    expect(r.internalTransfer).toBe(500_000);
    expect(r.total).toBe(0);
  });
});

describe("sumOutflows", () => {
  it("sums every field so the term total is exactly the sum of its months", () => {
    const a = { ...EMPTY_OUTFLOW, labor: 100, total: 100, internalTransfer: 7, appliedEvidenceIds: ["x"] };
    const b = {
      ...EMPTY_OUTFLOW,
      labor: 50,
      unclassified: 5,
      total: 55,
      unclassifiedItems: [{ date: "2026-06-01", amount: 5, reason: "balance_sheet_account" as const, account: "仮払金" }],
    };

    const sum = sumOutflows([a, b]);

    expect(sum.labor).toBe(150);
    expect(sum.unclassified).toBe(5);
    expect(sum.total).toBe(155);
    expect(sum.internalTransfer).toBe(7);
    expect(sum.appliedEvidenceIds).toEqual(["x"]);
    expect(sum.unclassifiedItems).toHaveLength(1);
  });
});

describe("computeJournalCashFlow: 給与・人件費の内訳と指定業務委託(v3.1)", () => {
  const accrual = (partner: string, debits: [string, number, string?][], payable = "未払金") => {
    const total = debits.reduce((s, [, a]) => s + a, 0);
    return group(
      "2026-07-31",
      debits.map(([account, amount, item]) => line(account, amount, item ?? "")),
      [line(payable, total, partner)]
    );
  };
  const settlement = (partner: string, amount: number, payable = "未払金", memo = "") =>
    group("2026-08-20", [line(payable, amount, partner, memo)], [cash(SMBC, amount, memo)]);

  const laborOf = (groups: JournalGroup[], evidenceGroups?: JournalGroup[]) =>
    compute(groups, { evidenceGroups });

  it("moves a designated contractor's 業務委託費 settlement (partner name exact match) from 外注費 to 給与・人件費", () => {
    const evidence = [accrual("松田徹", [["業務委託費", 1_000, "【業務委託】松田徹/デザイン"]], "未払金")];

    const r = laborOf([settlement("松田徹", 1_000)], evidence);

    expect(r.labor).toBe(1_000);
    expect(r.outsourcing).toBe(0);
    expect(r.laborDetail.contractors).toEqual({ 松田徹: 1_000 });
    expect(r.laborDetail.employeeSalary).toBe(0);
  });

  it("moves only the 業務委託費 part of a designated partner's accrual mix; other expenses of that partner stay where they were", () => {
    const evidence = [
      accrual("福場幸司郎", [
        ["業務委託費", 800, "【業務委託】福場幸司郎/コピー"],
        ["通信費", 200, "【通信】"],
      ]),
    ];

    const r = laborOf([settlement("福場幸司郎", 1_000)], evidence);

    expect(r.laborDetail.contractors).toEqual({ 福場幸司郎: 800 });
    expect(r.labor).toBe(800);
    expect(r.otherOperating).toBe(200);
    expect(r.outsourcing).toBe(0);
  });

  it("does not treat a different partner with a similar name (日比 秀一) as 日比由美", () => {
    const evidence = [
      accrual("日比 秀一", [["業務委託費", 500, "【業務委託】日比 秀一/デザイン"]]),
      accrual("日比由美", [["業務委託費", 300, "【業務委託】日比由美/デザイン"]]),
    ];

    const r = laborOf([settlement("日比 秀一", 500), settlement("日比由美", 300)], evidence);

    expect(r.outsourcing).toBe(500);
    expect(r.laborDetail.contractors).toEqual({ 日比由美: 300 });
  });

  it("does NOT use free-text memo to identify a designated contractor (name in memo of another partner's payment)", () => {
    const evidence = [accrual("株式会社X", [["業務委託費", 700, "【業務委託】株式会社X/制作"]])];

    const r = laborOf([settlement("株式会社X", 700, "未払金", "日比由美さん分のご依頼")], evidence);

    expect(r.outsourcing).toBe(700);
    expect(r.labor).toBe(0);
  });

  it("uses the item name (【業務委託】氏名/…) as the secondary key for a direct cash payment, but not a memo that merely contains the name", () => {
    const direct = group(
      "2025-10-10",
      [line("[製]業務委託費", 1_000, "【業務委託】松田徹/デザイン", "松田徹 10月分"), line("預り金", 100, "【業務委託】源泉所得税")],
      [cash(SMBC, 900)]
    );
    const memoOnly = group("2025-10-11", [line("[製]業務委託費", 400, "【業務委託】株式会社Y/制作", "福場幸司郎 の紹介")], [cash(SMBC, 400)]);

    const r = compute([direct, memoOnly]);

    // 現金900は借方(業務委託費1,000+預り金100)の比で按分される
    expect(r.laborDetail.contractors["松田徹"]).toBe(818);
    expect(r.laborDetail.contractors["福場幸司郎"]).toBeUndefined();
    expect(r.outsourcing).toBe(400);
  });

  it("classifies 退職金 and [製]退職金 as 給与・人件費 (退職金), while a retirement payable booked against 長期借入金 stays 借入元本返済", () => {
    const r = compute([
      group("2026-04-30", [line("[製]退職金", 500_000)], [cash(SMBC, 500_000)]),
      group("2026-05-29", [line("退職金", 300_000)], [cash(SMBC, 300_000)]),
      group("2025-09-01", [line("長期借入金", 200_000, "生山久展")], [cash(SMBC, 200_000)]),
    ]);

    expect(r.laborDetail.retirement).toBe(800_000);
    expect(r.labor).toBe(800_000);
    expect(r.financing).toBe(200_000);
    expect(r.other).toBe(0);
  });

  it("splits 給与・人件費 into 従業員給与/従業員賞与/役員(報酬・賞与)/退職金, and keeps 社会保険→税金・社保, 福利厚生費→諸経費", () => {
    const r = compute([
      group("2025-12-05", [line("[製]給料手当", 1_000), line("雑給", 50)], [cash(SMBC, 1_050)]),
      group("2025-12-05", [line("[製]賞与", 400), line("賞与", 100)], [cash(SMBC, 500)]),
      group("2025-12-05", [line("役員報酬", 300), line("役員賞与", 70)], [cash(SMBC, 370)]),
      group("2025-12-05", [line("法定福利費", 90)], [cash(SMBC, 90)]),
      group("2025-12-05", [line("福利厚生費", 30)], [cash(SMBC, 30)]),
    ]);

    expect(r.laborDetail.employeeSalary).toBe(1_050);
    expect(r.laborDetail.employeeBonus).toBe(500);
    expect(r.laborDetail.executive).toBe(370);
    expect(r.labor).toBe(1_050 + 500 + 370);
    expect(r.taxSocial).toBe(90);
    expect(r.otherOperating).toBe(30);
  });

  it("うち従業員給与計 = 従業員給与 + 従業員賞与 + 指定業務委託; excludes 役員・退職金・社会保険・福利厚生費", () => {
    const evidence = [accrual("松田徹", [["業務委託費", 200, "【業務委託】松田徹/デザイン"]])];
    const r = laborOf(
      [
        group("2025-12-05", [line("給料手当", 1_000)], [cash(SMBC, 1_000)]),
        group("2025-12-05", [line("賞与", 500)], [cash(SMBC, 500)]),
        group("2025-12-05", [line("役員報酬", 300)], [cash(SMBC, 300)]),
        group("2025-12-05", [line("退職金", 70)], [cash(SMBC, 70)]),
        group("2025-12-05", [line("法定福利費", 90)], [cash(SMBC, 90)]),
        group("2025-12-05", [line("福利厚生費", 30)], [cash(SMBC, 30)]),
        settlement("松田徹", 200),
      ],
      evidence
    );

    expect(employeeSalarySubtotal(r.laborDetail)).toBe(1_000 + 500 + 200);
    expect(r.labor).toBe(1_000 + 500 + 300 + 70 + 200);
  });

  it("classifies a payroll transfer by tag: 取締役タグ・【給与】現金渡し are 役員, other department tags are 従業員給与", () => {
    const pay = (memo: string, amount: number) => settlement("", amount, "未払金", memo);

    const r = compute([pay("CR1 ﾌﾘｺﾐ", 4_000), pay("管理部 ﾌﾘｺﾐ", 600), pay("取締役 ﾌﾘｺﾐ", 3_000), pay("【給与】未払金（給与現金支給分） 役員報酬 現金渡し", 200)]);

    expect(r.laborDetail.employeeSalary).toBe(4_600);
    expect(r.laborDetail.executive).toBe(3_200);
    expect(r.labor).toBe(7_800);
  });

  it("separates the bonus payable (発生仕訳の未払金) from the same month's payroll transfers into 従業員賞与, without changing 給与・人件費", () => {
    const bonusAccrual = group(
      "2026-07-07",
      [line("[製]賞与", 5_000)],
      [line("預り金", 1_000), line("未払金", 4_000)]
    );
    const execBonusAccrual = group("2026-07-07", [line("役員賞与", 700)], [line("預り金", 250), line("未払金", 450)]);
    const transfers = [
      settlement("", 10_000, "未払金", "CR1 ﾌﾘｺﾐ"), // 通常の給与6,000+賞与4,000
      settlement("", 3_450, "未払金", "取締役 ﾌﾘｺﾐ"), // 役員報酬3,000+役員賞与450
    ];

    const r = compute([bonusAccrual, execBonusAccrual, ...transfers]);

    expect(r.laborDetail.employeeBonus).toBe(4_000);
    expect(r.laborDetail.employeeSalary).toBe(6_000);
    expect(r.laborDetail.executive).toBe(3_450);
    expect(r.labor).toBe(13_450);
  });

  it("営業支出合計 is unchanged by the reclassification over 12 months (指定業務委託・退職金を給与・人件費へ移すだけ)", () => {
    const evidence = [accrual("松田徹", [["業務委託費", 100, "【業務委託】松田徹/デザイン"]]), accrual("株式会社Z", [["業務委託費", 100, "【業務委託】株式会社Z/制作"]])];
    let expectedOperating = 0;
    let actualOperating = 0;
    for (let month = 1; month <= 12; month++) {
      const mm = String(month).padStart(2, "0");
      const groups = [
        group(`2026-${mm}-05`, [line("給料手当", 1_000 + month)], [cash(SMBC, 1_000 + month)]),
        settlement("松田徹", 100 + month),
        settlement("株式会社Z", 100 + month),
        group(`2026-${mm}-06`, [line("退職金", 10 + month)], [cash(SMBC, 10 + month)]),
        group(`2026-${mm}-07`, [line("通信費", 5)], [cash(SMBC, 5)]),
        group(`2026-${mm}-08`, [line("租税公課", 7)], [cash(SMBC, 7)]),
        group(`2026-${mm}-09`, [line("特殊な経費", 3)], [cash(SMBC, 3)]),
        group(`2026-${mm}-10`, [line("長期借入金", 50)], [cash(SMBC, 50)]),
      ];
      const r = compute(groups, { evidenceGroups: evidence });
      expectedOperating += 1_000 + month + 2 * (100 + month) + (10 + month) + 5 + 7 + 3;
      actualOperating += r.labor + r.outsourcing + r.taxSocial + r.otherOperating + r.other;
      expect(r.labor + r.outsourcing + r.taxSocial + r.otherOperating + r.other).toBe(
        1_000 + month + 2 * (100 + month) + (10 + month) + 5 + 7 + 3
      );
      expect(r.outsourcing).toBe(100 + month); // 指定業務委託(松田徹)だけが外注費から抜ける
      expect(r.other).toBe(3); // 退職金はその他から抜け、本来のその他(特殊な経費)だけが残る
    }
    expect(actualOperating).toBe(expectedOperating);
  });

  it("keeps the legacy category integers exactly when a journal mixes designated-contractor and other 外注費 lines (二段階按分)", () => {
    const mixed = group(
      "2026-03-10",
      [
        line("[製]業務委託費", 333, "【業務委託】松田徹/デザイン"),
        line("[製]業務委託費", 333, "【業務委託】株式会社Q/制作"),
        line("通信費", 334),
      ],
      [cash(SMBC, 1_000)]
    );

    const r = compute([mixed]);

    expect(r.labor + r.outsourcing).toBe(666);
    expect(r.otherOperating).toBe(334);
    expect(r.total).toBe(1_000);
  });

  it("keeps the legacy integers when a journal mixes 退職金 with other 諸経費/その他 lines (退職金は旧区分ではその他として按分)", () => {
    const mixed = group(
      "2026-04-30",
      [line("通信費", 1), line("退職金", 1), line("特殊な経費", 1)],
      [cash(SMBC, 100)]
    );

    const r = compute([mixed]);

    // 旧区分: 諸経費 1/3=33、その他(退職金+特殊な経費) 2/3=67。退職金はそのうち給与・人件費へ移るだけ
    expect(r.otherOperating).toBe(33);
    expect(r.labor + r.other).toBe(67);
    expect(r.total).toBe(100);
  });
});

describe("sumLaborDetails / employeeSalarySubtotal", () => {
  it("merges contractor maps and sums the reference detail", () => {
    const a = { employeeSalary: 100, employeeBonus: 10, executive: 5, retirement: 1, contractors: { 松田徹: 3 } };
    const b = { employeeSalary: 200, employeeBonus: 0, executive: 7, retirement: 0, contractors: { 松田徹: 2, 日比由美: 4 } };

    const sum = sumLaborDetails([a, b, undefined]);

    expect(sum.contractors).toEqual({ 松田徹: 5, 日比由美: 4 });
    expect(employeeSalarySubtotal(sum)).toBe(300 + 10 + 9);
    expect(sum.executive).toBe(12);
    expect(sum.retirement).toBe(1);
  });
});
