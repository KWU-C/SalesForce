import { describe, expect, it } from "vitest";
import { EMPTY_INFLOW } from "./cashInflow";
import { EMPTY_LABOR_DETAIL, EMPTY_OUTFLOW, employeeSalarySubtotal } from "./cashOutflow";
import {
  __OPENING_ROW_FOR_TEST__ as OPENING_ROW,
  __CLOSING_ROW_FOR_TEST__ as CLOSING_ROW,
  __SECTIONS_FOR_TEST__ as SECTIONS,
} from "./MonthlyCashFlowScrollTable";
import type { MonthlyCashFlow } from "./types";

/**
 * 情報設計の再構成(2026-09-20/21、営業活動→財務・資産活動→参考・調整→資金結果の4タイルに
 * 分割、財務・資産活動は入金/借入返済/資産移動に細分化)の前後で、全ての行が指し示す金額が
 * 変わっていないことを検算する。各フィールドに重複しない値を割り当て、ラベルごとに
 * 「取得元フィールドが正しいか」を突き合わせる(表示順・見出し・スタイルの変更のみで
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

function section(key: string) {
  const found = SECTIONS.find((s) => s.key === key);
  if (!found) throw new Error(`section not found: ${key}`);
  return found;
}

function getByLabel(rows: typeof SECTIONS[number]["rows"], label: string) {
  const row = rows.find((r) => r.kind === "value" && r.label === label);
  if (!row || row.kind !== "value") {
    throw new Error(`row not found: ${label}`);
  }
  return row.get;
}

describe("MonthlyCashFlowScrollTable rows", () => {
  const cf = buildFixture();

  it("月初現預金・月末現預金は見出しを持たない単独ペアで、月末現預金が最終到達点(finalMetric)", () => {
    expect(OPENING_ROW.label).toBe("月初現預金");
    expect(OPENING_ROW.get(cf)).toBe(cf.cashOpening);
    expect(CLOSING_ROW.label).toBe("月末現預金");
    expect(CLOSING_ROW.get(cf)).toBe(cf.cashClosing);
    expect(CLOSING_ROW.finalMetric).toBe(true);
  });

  it("営業活動タイルの入金は既存の入金内訳フィールドを指す", () => {
    const rows = section("operating").rows;
    expect(getByLabel(rows, "営業入金")(cf)).toBe(cf.inflow!.operating);
    expect(getByLabel(rows, "うち帳簿補完(銀行明細欠落)")(cf)).toBe(cf.inflow!.operatingLedgerOnly);
  });

  it("営業活動タイルの支出は既存の支出区分・集計と一致する", () => {
    const rows = section("operating").rows;
    expect(getByLabel(rows, "給与・人件費")(cf)).toBe(cf.expenseByCategory.labor);
    expect(getByLabel(rows, "うち従業員給与計")(cf)).toBe(employeeSalarySubtotal(cf.outflow!.laborDetail));
    expect(getByLabel(rows, "外注費")(cf)).toBe(cf.expenseByCategory.outsourcing);
    expect(getByLabel(rows, "税金・社会保険等")(cf)).toBe(cf.expenseByCategory.taxSocial);
    expect(getByLabel(rows, "諸経費")(cf)).toBe(cf.expenseByCategory.otherOperating);
    expect(getByLabel(rows, "その他")(cf)).toBe(cf.expenseByCategory.other);
    expect(getByLabel(rows, "営業支出合計")(cf)).toBe(
      cf.expenseByCategory.labor +
        cf.expenseByCategory.outsourcing +
        cf.expenseByCategory.taxSocial +
        cf.expenseByCategory.otherOperating +
        cf.expenseByCategory.other,
    );
    expect(getByLabel(rows, "営業キャッシュ収支")(cf)).toBe(cf.operatingCashFlow);
  });

  it("財務・資産活動タイルは借入/資産/その他の3小区分に整理され、既存フィールドを指す", () => {
    const rows = section("financing").rows;
    // 借入
    expect(getByLabel(rows, "借入による入金")(cf)).toBe(cf.inflow!.borrowing);
    expect(getByLabel(rows, "当月元本返済")(cf)).toBe(cf.financingCashFlow);
    expect(getByLabel(rows, "支払利息")(cf)).toBe(cf.interestCashFlow);
    // 資産
    expect(getByLabel(rows, "保険・資産回収等")(cf)).toBe(cf.inflow!.assetRecovery);
    expect(getByLabel(rows, "積立・資産移動")(cf)).toBe(cf.assetTransferCashFlow);
    // その他(入金・出金が混在するため方向を明示するラベルにしている)
    expect(getByLabel(rows, "その他（入金）")(cf)).toBe(cf.inflow!.other);
    expect(getByLabel(rows, "未分類（入金）")(cf)).toBe(cf.inflow!.unclassified);
    expect(getByLabel(rows, "未分類（出金）")(cf)).toBe(cf.outflow!.unclassified);

    const bandLabels = rows.filter((r) => r.kind === "band").map((r) => r.label);
    expect(bandLabels).toEqual(["借入", "資産", "その他"]);
    // 財務・資産活動の帯は営業活動と異なりインデント+通常の太さのまま(bold指定なし)
    expect(rows.filter((r) => r.kind === "band").every((r) => !r.bold)).toBe(true);
  });

  it("営業活動の入金/支出の帯だけインデントを外し太字にする(財務・資産活動の帯は対象外)", () => {
    const operatingBands = section("operating").rows.filter((r) => r.kind === "band");
    expect(operatingBands.map((r) => r.label)).toEqual(["入金", "支出"]);
    expect(operatingBands.every((r) => r.bold)).toBe(true);
  });

  it("参考・調整タイルは入金側・出金側で別フィールドを指す(合算しない)、かつmuted(折りたたみ対象)", () => {
    const referenceSection = section("reference");
    expect(referenceSection.muted).toBe(true);
    const rows = referenceSection.rows;
    expect(getByLabel(rows, "内部移動（入金） ※合計に含めず")(cf)).toBe(cf.inflow!.internalTransfer);
    expect(getByLabel(rows, "内部移動（出金） ※合計に含めず")(cf)).toBe(cf.outflow!.internalTransfer);
    expect(getByLabel(rows, "ネットゼロ往復（入金） ※帳簿未計上・合計に含めず")(cf)).toBe(cf.inflow!.netZeroRoundTrip);
    expect(getByLabel(rows, "ネットゼロ往復（出金） ※帳簿未計上・合計に含めず")(cf)).toBe(cf.outflow!.netZeroRoundTrip);
    expect(getByLabel(rows, "帳簿補完（出金側）")(cf)).toBe(cf.outflow!.ledgerOnly);
    expect(getByLabel(rows, "検算差額（現金増減−(入金−出金)）")(cf)).toBe(
      cf.cashChange! - (cf.externalIncome - cf.externalExpenseTotal),
    );
  });

  it("資金結果の行は既存のキャッシュイン/アウト合計・現金増減の値を変えていない(月末現預金は含まない)", () => {
    const rows = section("result").rows;
    expect(getByLabel(rows, "キャッシュイン合計")(cf)).toBe(cf.externalIncome);
    expect(getByLabel(rows, "キャッシュアウト合計（外部支出）")(cf)).toBe(cf.externalExpenseTotal);
    expect(getByLabel(rows, "当月現金増減")(cf)).toBe(cf.cashChange);
    // 月末現預金は表全体の最終到達点として月初現預金の直下へ移した(CLOSING_ROW)ため、
    // 資金結果の行一覧には含まれない(ユーザー確定、2026-09-21)
    expect(rows.some((r) => r.kind === "value" && r.label === "月末現預金")).toBe(false);
  });

  it("4タイルの構成は営業活動・財務・資産活動・参考・調整・資金結果の順で、参考・調整のみmuted", () => {
    expect(SECTIONS.map((s) => s.key)).toEqual(["operating", "financing", "reference", "result"]);
    expect(SECTIONS.map((s) => s.title)).toEqual(["営業活動", "財務・資産活動", "参考・調整", "資金結果"]);
    expect(SECTIONS.map((s) => Boolean(s.muted))).toEqual([false, false, true, false]);
  });

  it("負値時に赤系ステータス色へ切り替える対象は営業キャッシュ収支・当月現金増減のみ", () => {
    const negativeRedRows = SECTIONS.flatMap((s) => s.rows)
      .filter((r) => r.kind === "value" && r.negativeRed)
      .map((r) => r.label);
    expect(negativeRedRows).toEqual(["営業キャッシュ収支", "当月現金増減"]);
  });

  it("月末現預金(CLOSING_ROW)は表全体で唯一のfinalMetric(最終到達点)として扱う。SECTIONS配下にはfinalMetric行が無い", () => {
    const finalMetricRowsInSections = SECTIONS.flatMap((s) => s.rows).filter(
      (r) => r.kind === "value" && r.finalMetric,
    );
    expect(finalMetricRowsInSections).toHaveLength(0);
    expect(CLOSING_ROW.finalMetric).toBe(true);
  });

  it("キャッシュイン合計とキャッシュアウト合計の定義(値)は変更していない", () => {
    expect(cf.externalIncome).toBe(8_000_000);
    expect(cf.externalExpenseTotal).toBe(5_655_000);
  });
});
