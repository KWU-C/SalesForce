import { describe, expect, it } from "vitest";
import { EMPTY_INFLOW } from "./cashInflow";
import { EMPTY_LABOR_DETAIL, EMPTY_OUTFLOW, employeeSalarySubtotal } from "./cashOutflow";
import { __ROWS_FOR_TEST__ as ROWS } from "./MonthlyCashFlowScrollTable";
import type { MonthlyCashFlow } from "./types";

/**
 * 情報設計の並び替え(2026-09-20、月初資金→営業活動→財務・資産活動→参考・調整→資金結果)の
 * 前後で、全ての行が指し示す金額が変わっていないことを検算する。各フィールドに重複しない値を
 * 割り当て、ラベルごとに「取得元フィールドが正しいか」を突き合わせる(表示順・見出しの変更のみで
 * 計算ロジック・分類ロジックには手を入れていないことの回帰テスト)。
 */
function buildFixture(): MonthlyCashFlow {
  return {
    fiscalYear: 49,
    month: 8,
    cashOpening: 10_000_000,
    cashClosing: 12_345_000,
    cashChange: 2_345_000,
    externalIncome: 8_000_000,
    inflow: {
      ...EMPTY_INFLOW,
      operating: 6_500_000,
      operatingLedgerOnly: 150_000,
      borrowing: 900_000,
      assetRecovery: 200_000,
      other: 300_000,
      unclassified: 100_000,
      total: 8_000_000,
      internalTransfer: 400_000,
      netZeroRoundTrip: 50_000,
    },
    externalExpenseTotal: 5_655_000,
    outflow: {
      ...EMPTY_OUTFLOW,
      labor: 2_000_000,
      laborDetail: {
        ...EMPTY_LABOR_DETAIL,
        employeeSalary: 1_200_000,
        employeeBonus: 100_000,
        executive: 500_000,
        retirement: 50_000,
        contractors: { "業務委託A": 150_000 },
      },
      outsourcing: 800_000,
      taxSocial: 600_000,
      otherOperating: 400_000,
      other: 100_000,
      financing: 700_000,
      interest: 30_000,
      assetTransfer: 500_000,
      unclassified: 60_000,
      total: 5_655_000,
      internalTransfer: 410_000,
      netZeroRoundTrip: 55_000,
      ledgerOnly: 70_000,
    },
    calculationVersion: "test",
    status: "final",
    expenseByCategory: {
      labor: 2_000_000,
      outsourcing: 800_000,
      taxSocial: 600_000,
      otherOperating: 400_000,
      other: 100_000,
      financing: 700_000,
      interest: 30_000,
      assetTransfer: 500_000,
    },
    operatingCashFlow: 2_600_000,
    financingCashFlow: 700_000,
    interestCashFlow: 30_000,
    assetTransferCashFlow: 500_000,
    fetchedAt: new Date("2026-09-01"),
  };
}

describe("MonthlyCashFlowScrollTable ROWS", () => {
  const cf = buildFixture();

  it("月初資金セクションは月初現預金を指す", () => {
    expect(getByLabel("月初現預金")(cf)).toBe(cf.cashOpening);
  });

  it("営業活動-入金は既存の入金内訳フィールドを指す", () => {
    expect(getByLabel("営業入金")(cf)).toBe(cf.inflow!.operating);
    expect(getByLabel("うち帳簿補完(銀行明細欠落)")(cf)).toBe(cf.inflow!.operatingLedgerOnly);
  });

  it("営業活動-支出は既存の支出区分・集計と一致する", () => {
    expect(getByLabel("給与・人件費")(cf)).toBe(cf.expenseByCategory.labor);
    expect(getByLabel("うち従業員給与計")(cf)).toBe(employeeSalarySubtotal(cf.outflow!.laborDetail));
    expect(getByLabel("外注費")(cf)).toBe(cf.expenseByCategory.outsourcing);
    expect(getByLabel("税金・社会保険等")(cf)).toBe(cf.expenseByCategory.taxSocial);
    expect(getByLabel("諸経費")(cf)).toBe(cf.expenseByCategory.otherOperating);
    // ROWS内に「その他」ラベルが複数(営業支出のother、財務・資産活動の入金other)あるため、
    // 支出側の「その他」は2番目に出現するインデックスで取得する
    const otherRows = ROWS.filter((r) => r.kind === "value" && r.label === "その他");
    expect((otherRows[0] as { get: (cf: MonthlyCashFlow) => number | null }).get(cf)).toBe(cf.expenseByCategory.other);
    expect(getByLabel("営業支出合計")(cf)).toBe(
      cf.expenseByCategory.labor +
        cf.expenseByCategory.outsourcing +
        cf.expenseByCategory.taxSocial +
        cf.expenseByCategory.otherOperating +
        cf.expenseByCategory.other,
    );
    expect(getByLabel("営業キャッシュ収支（営業入金−営業支出）")(cf)).toBe(cf.operatingCashFlow);
  });

  it("財務・資産活動-入金は既存の入金内訳フィールドを指す", () => {
    expect(getByLabel("借入による入金")(cf)).toBe(cf.inflow!.borrowing);
    expect(getByLabel("保険・資産回収等")(cf)).toBe(cf.inflow!.assetRecovery);
    const otherRows = ROWS.filter((r) => r.kind === "value" && r.label === "その他");
    expect((otherRows[1] as { get: (cf: MonthlyCashFlow) => number | null }).get(cf)).toBe(cf.inflow!.other);
    expect(getByLabel("未分類")(cf)).toBe(cf.inflow!.unclassified);
  });

  it("財務・資産活動-支出は既存フィールド・集計と一致する", () => {
    expect(getByLabel("当月元本返済")(cf)).toBe(cf.financingCashFlow);
    expect(getByLabel("支払利息")(cf)).toBe(cf.interestCashFlow);
    expect(getByLabel("借入関連支出合計")(cf)).toBe(cf.financingCashFlow + cf.interestCashFlow);
    expect(getByLabel("積立・資産移動")(cf)).toBe(cf.assetTransferCashFlow);
    expect(getByLabel("未分類（出金）")(cf)).toBe(cf.outflow!.unclassified);
  });

  it("参考・調整は入金側・出金側で別フィールドを指す(合算しない)", () => {
    expect(getByLabel("内部移動（入金） ※合計に含めず")(cf)).toBe(cf.inflow!.internalTransfer);
    expect(getByLabel("内部移動（出金） ※合計に含めず")(cf)).toBe(cf.outflow!.internalTransfer);
    expect(getByLabel("ネットゼロ往復（入金） ※帳簿未計上・合計に含めず")(cf)).toBe(cf.inflow!.netZeroRoundTrip);
    expect(getByLabel("ネットゼロ往復（出金） ※帳簿未計上・合計に含めず")(cf)).toBe(cf.outflow!.netZeroRoundTrip);
    expect(getByLabel("帳簿補完（出金側）")(cf)).toBe(cf.outflow!.ledgerOnly);
    expect(getByLabel("検算差額（現金増減−(入金−出金)）")(cf)).toBe(
      cf.cashChange! - (cf.externalIncome - cf.externalExpenseTotal),
    );
  });

  it("資金結果は既存のキャッシュイン/アウト合計・現金増減・月末残高を移動しただけで値は変えていない", () => {
    expect(getByLabel("キャッシュイン合計")(cf)).toBe(cf.externalIncome);
    expect(getByLabel("キャッシュアウト合計（外部支出）")(cf)).toBe(cf.externalExpenseTotal);
    expect(getByLabel("当月現金増減")(cf)).toBe(cf.cashChange);
    expect(getByLabel("月末現預金")(cf)).toBe(cf.cashClosing);
  });

  it("セクション見出し・帯の行数は5セクション×各1、入金/支出の帯は4本(営業活動・財務資産活動それぞれ2本)", () => {
    const sectionLabels = ROWS.filter((r) => r.kind === "section").map((r) => r.label);
    expect(sectionLabels).toEqual(["月初資金", "営業活動", "財務・資産活動", "参考・調整", "資金結果"]);

    const bandRows = ROWS.filter((r) => r.kind === "band");
    expect(bandRows).toHaveLength(4);
    expect(bandRows.map((r) => r.label)).toEqual(["入金", "支出", "入金", "支出"]);
  });

  it("キャッシュイン合計とキャッシュアウト合計の定義(値)は変更していない", () => {
    expect(cf.externalIncome).toBe(8_000_000);
    expect(cf.externalExpenseTotal).toBe(5_655_000);
  });
});

function getByLabel(label: string) {
  const row = ROWS.find((r) => r.kind === "value" && r.label === label);
  if (!row || row.kind !== "value") {
    throw new Error(`row not found: ${label}`);
  }
  return row.get;
}
