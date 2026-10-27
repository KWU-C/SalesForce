import { describe, expect, it } from "vitest";
import type { FreeeTrialBalanceResponse, FreeeTrialBalanceRow } from "@/services/freee/freeeAccountingClient";
import { MOTHER_PARTNER_ID } from "@/config/performanceClassification";
import { extractMonthlyPerformance } from "./monthlyPerformance";

// 月指定の試算表は期首からの累計で返るため、単月値 = closing − opening になるよう opening を入れておく
function total(category: string, amount: number, opening = 1000): FreeeTrialBalanceRow {
  return {
    account_category_name: category,
    total_line: true,
    hierarchy_level: 1,
    opening_balance: opening,
    debit_amount: 0,
    credit_amount: 0,
    closing_balance: opening + amount,
    composition_ratio: 0,
  };
}

function account(
  category: string,
  name: string,
  amount: number,
  extra: Partial<FreeeTrialBalanceRow> = {}
): FreeeTrialBalanceRow {
  return {
    account_category_name: category,
    account_item_name: name,
    hierarchy_level: 3,
    opening_balance: 500,
    debit_amount: 0,
    credit_amount: 0,
    closing_balance: 500 + amount,
    composition_ratio: 0,
    ...extra,
  };
}

function sub(id: number, name: string, amount: number) {
  return { id, name, opening_balance: 10, debit_amount: amount, credit_amount: 0, closing_balance: 10 + amount };
}

function response(balances: FreeeTrialBalanceRow[]): FreeeTrialBalanceResponse {
  return { company_id: 1, fiscal_year: 2026, balances };
}

const plTotals = [
  total("売上高", 10_000),
  total("売上総損益金額", 2_500),
  total("販売管理費", 2_000),
  total("営業損益金額", 500),
  total("営業外収益", 300),
  total("営業外費用", 100),
  total("経常損益金額", 700),
];

function reports(options: { wipActivity: boolean }) {
  const crTotals = [total("労務費", 5_000), total("製造経費", 1_500)];
  return {
    plByPartner: response([
      ...plTotals,
      account("販売管理費", "賃借料・地代家賃", 400, {
        partners: [sub(MOTHER_PARTNER_ID, "有限会社ティーシーディマザー", 150), sub(99, "他の貸主", 250)],
      }),
      account("販売管理費", "業務委託費", 80, { partners: [sub(MOTHER_PARTNER_ID, "有限会社ティーシーディマザー", 80)] }),
      // マザーからの雑収入は支出に入れない
      account("営業外収益", "雑収入", 60, { partners: [sub(MOTHER_PARTNER_ID, "有限会社ティーシーディマザー", 60)] }),
    ]),
    plByItem: response([
      ...plTotals,
      account("販売管理費", "賃借料・地代家賃", 400, {
        items: [sub(1, "【地代・家賃】芦屋オフィス地代", 150), sub(2, "【取引先】催事スペース", 250)],
      }),
      account("販売管理費", "修繕費", 30, { items: [sub(3, "【設備保全】設備保全費", 30)] }),
    ]),
    crByPartner: response([
      ...crTotals,
      account("製造経費", "[製]外注加工費", 700, { partners: [sub(5, "印刷会社", 700)] }),
      account("製造経費", "[製]業務委託費", 200, { partners: [sub(MOTHER_PARTNER_ID, "有限会社ティーシーディマザー", 200)] }),
      account("期末仕掛品棚卸", "[製]期末仕掛品", 0, options.wipActivity ? { debit_amount: 9, credit_amount: 9 } : {}),
    ]),
    crByItem: response([
      ...crTotals,
      account("製造経費", "[製]賃借料", 120, {
        items: [sub(6, "【リース】複合機", 90), sub(0, "未選択", 30)],
      }),
      account("製造経費", "[製]地代家賃", 300, { items: [sub(7, "【地代・家賃】東京オフィス", 300)] }),
    ]),
  };
}

describe("extractMonthlyPerformance", () => {
  it("小計行・科目行の単月値(期末残高−期首残高)を取り出す", () => {
    const p = extractMonthlyPerformance(reports({ wipActivity: true }));
    expect(p).toMatchObject({
      revenue: 10_000,
      grossProfit: 2_500,
      sga: 2_000,
      operatingProfit: 500,
      nonOperatingIncome: 300,
      nonOperatingExpense: 100,
      ordinaryProfit: 700,
      laborCost: 5_000,
      outsourcingCost: 700,
      manufacturingConsignmentCost: 200,
    });
  });

  it("建物関連費用は候補科目のうち品目が【地代・家賃】のものだけ。リース・設備保全・他の品目は含めず、品目未選択は別に返す", () => {
    const p = extractMonthlyPerformance(reports({ wipActivity: true }));
    expect(p.buildingLines).toEqual([
      { account: "賃借料・地代家賃", item: "【地代・家賃】芦屋オフィス地代", amount: 150 },
      { account: "[製]地代家賃", item: "【地代・家賃】東京オフィス", amount: 300 },
    ]);
    expect(p.buildingCost).toBe(450);
    expect(p.buildingCandidateUnassigned).toBe(30);
  });

  it("マザー関連支出は取引先がマザーの費用だけ(製造経費・販管費)。雑収入は含めない", () => {
    const p = extractMonthlyPerformance(reports({ wipActivity: true }));
    expect(p.motherLines).toEqual([
      { account: "[製]業務委託費", amount: 200 },
      { account: "賃借料・地代家賃", amount: 150 },
      { account: "業務委託費", amount: 80 },
    ]);
    expect(p.motherExpense).toBe(430);
  });

  it("仕掛品振替は[製]期末仕掛品の当月の借方・貸方の有無だけで判定する", () => {
    expect(extractMonthlyPerformance(reports({ wipActivity: true })).wipTransferDetected).toBe(true);
    expect(extractMonthlyPerformance(reports({ wipActivity: false })).wipTransferDetected).toBe(false);
  });

  it("区分の計が無い場合はnull(0円にしない)。使っていない科目は0円", () => {
    const empty = response([]);
    const p = extractMonthlyPerformance({ plByPartner: empty, plByItem: empty, crByPartner: empty, crByItem: empty });
    expect(p.revenue).toBeNull();
    expect(p.laborCost).toBeNull();
    expect(p.outsourcingCost).toBe(0);
    expect(p.buildingCost).toBe(0);
    expect(p.wipTransferDetected).toBe(false);
  });
});
