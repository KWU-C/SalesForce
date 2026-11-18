import { describe, expect, it } from "vitest";
import { computeCash } from "./cashEngine";
import type { SfReceiptEvent } from "./salesMatching";
import type { RfDeal, RfInputs, RfWalletTxn } from "./types";

const CHECKING = 1;
const NOTES = 9;
let seq = 1000;
const txn = (date: string, amount: number, description: string, entrySide: "income" | "expense" = "expense", walletableId = CHECKING): RfWalletTxn => ({
  id: seq++,
  date,
  amount,
  description,
  entrySide,
  walletableType: "bank_account",
  walletableId,
  status: 2,
});
const deal = (p: Partial<RfDeal> & { type: RfDeal["type"]; amount: number }): RfDeal => ({
  id: seq++,
  issueDate: "2026-10-31",
  dueDate: null,
  dueAmount: 0,
  partnerId: null,
  details: [],
  payments: [],
  ...p,
});
const payroll = (transfer: number, expense = 100_000, payDate = "2026-11-25", fixed = 0) => ({
  count: 10,
  fixed,
  transfer,
  expense,
  calculatedAt: "2026-11-17",
  workedZero: 0,
  payDate,
});

function inputs(): RfInputs {
  const walletTxns: RfWalletTxn[] = [];
  for (const [m, payDay, monthEnd] of [
    ["2026-08", "2026-08-20", "2026-08-31"],
    ["2026-09", "2026-09-17", "2026-09-30"],
    ["2026-10", "2026-10-20", "2026-10-30"],
  ] as const) {
    walletTxns.push(txn(payDay, 10_100_000, "ﾌﾘｺﾐ")); // 給与振込(明細 10,000,000 との差 100,000)
    walletTxns.push(txn(monthEnd, 3_000_000, "ﾌﾘｺﾐ")); // 月末一括振込(すべて一般経費)
    walletTxns.push(txn(`${m}-10`, 1_000_000, "ｼﾖｳｶﾞｼ")); // 借入返済
  }
  // 社会保険料(月末の口座振替。10/31(土)分は11/2に引落)
  walletTxns.push(txn("2026-08-31", 2_000_000, "64608053"), txn("2026-09-30", 2_000_000, "64608053"), txn("2026-11-02", 2_000_000, "64608053"));
  return {
    computedAt: "2026-11-18T12:00:00+09:00",
    bankSyncedThrough: "2026-11-16",
    walletableUpdateRange: { min: null, max: null },
    baseBalances: { checking: 50_000_000, timeDeposit: 10_000_000, cash: 100_000 },
    partners: new Map([[1, "電子債権の会社"], [2, "普通の会社"]]),
    walletables: [
      { id: CHECKING, name: "当座預金_テスト", type: "bank_account", updateDate: "2026-11-16" },
      { id: NOTES, name: "受取手形・電子債権", type: "wallet", updateDate: null },
    ],
    walletTxns,
    transfers: [],
    incomeDeals: [
      // 電子債権で決済する取引先(過去3回とも電子債権)
      ...["2026-07-27", "2026-08-27", "2026-09-28"].map((d) =>
        deal({ type: "income", amount: 100_000, partnerId: 1, issueDate: "2026-06-30", dueDate: d, payments: [{ date: d, amount: 100_000, walletableType: "wallet", walletableId: NOTES }] })
      ),
      deal({ type: "income", amount: 300_000, dueAmount: 300_000, partnerId: 1, dueDate: "2026-11-30" }),
      deal({ type: "income", amount: 5_000_000, dueAmount: 5_000_000, partnerId: 2, dueDate: "2026-11-30" }),
    ],
    expenseDeals: [
      // 経費精算(支給日期日。給与明細の経費精算と同額)
      deal({ type: "expense", amount: 100_000, dueAmount: 100_000, dueDate: "2026-11-25", details: [{ accountName: "旅費交通費", amount: 100_000, description: "" }] }),
      // 借入返済の予定(発生日は基準日より後)
      ...[600_000, 400_000].map((a) =>
        deal({ type: "expense", amount: a, dueAmount: a, issueDate: "2026-12-10", dueDate: "2026-12-10", details: [{ accountName: "長期借入金", amount: a, description: "" }] })
      ),
    ],
    payroll: { "2026-08": payroll(10_000_000, 100_000, "2026-08-25", 10), "2026-09": payroll(10_000_000, 100_000, "2026-09-25", 10), "2026-10": payroll(10_000_000, 100_000, "2026-10-25", 10), "2026-11": payroll(10_000_000), "2026-12": payroll(9_000_000, 0, "2026-12-25"), "2025-12": null },
    bonus: {},
    bonusHistory: {},
    sfProcesses: [],
    sfCosts: [],
    reserve: { trialBsByMonth: {}, provisionalTaxDeals: [], consumptionTaxPayableDeals: [], consumptionTaxPayableJournals: [], closingJournals: [] },
  };
}

const sfSameDay: SfReceiptEvent = { date: "2026-11-30", amount: 700_000, kind: "SF予定", billed: "2026-11-30", sfId: "SF-x", freeeSameAmountLater: false };

describe("資金の参考予測(DEVの再計算)", () => {
  const out = computeCash(inputs(), [sfSameDay]);
  const std = out.cases.find((c) => c.id === "standard")!;
  const adj = out.checks.adjustments as { byCase: Record<string, Record<string, unknown>>; generalBulk: unknown; skippedRecurring: unknown[]; unregisteredGaichu: unknown };
  const daily = (cat: string, month: string) => out.dailyStandard.filter((e) => e.cat === cat && e.date.startsWith(month));

  it("内訳の合計が残高の増減と一致し、主なケースがそろう", () => {
    expect(out.cases.map((c) => c.id)).toEqual(["standard", "cautious", "yearEndSlip", "cautiousYearEndSlip"]);
    for (const c of out.cases) for (const m of c.months) expect(Object.values(m.byBasis).reduce((a, b) => a + b, 0)).toBe(m.end - m.start);
  });

  it("経費精算は給与明細の振込額に含まれるため、支給日期日の登録済み支払と重ねない", () => {
    expect(adj.byCase.standard["reimbursement_2026-11"]).toMatchObject({ registered: 100_000, statementExpense: 100_000, excluded: true });
    expect(daily("出金:一般経費", "2026-11").reduce((s, e) => s + e.amount, 0)).toBe(0);
    expect(daily("出金:給与", "2026-11")).toEqual([expect.objectContaining({ date: "2026-11-19", amount: -10_000_000 })]);
    expect(daily("出金:給与(明細との差)", "2026-11")[0].amount).toBe(-100_000);
  });

  it("請求日と入金予定日が同じSalesforce追加分は翌月末へ動かし、仮定として記録する", () => {
    expect(adj.byCase.standard.sfMoved).toEqual([{ sfId: "SF-x", amount: 700_000, from: "2026-11-30", to: "2026-12-31" }]);
    expect(std.months[0].byCategory["入金:売掛(SF追加・入金月は仮定)"]).toBeUndefined();
    expect(std.months[1].byCategory["入金:売掛(SF追加・入金月は仮定)"]).toBe(700_000);
    expect(out.notes.estimates.some((t) => t.startsWith("仮定（確定情報ではない）：Salesforce"))).toBe(true);
  });

  it("電子債権で決済する取引先の売上は予測期間の現金に入れない", () => {
    expect(adj.byCase.standard.notes).toEqual([{ due: "2026-11-30", amount: 300_000, assumedCashMonth: "2027-01" }]);
    expect(std.months[0].byCategory["入金:売掛"]).toBe(5_000_000);
  });

  it("月末の口座振替は翌月にずれる(12/31→1/4)。慎重は予測の最終月の分を月内に置く", () => {
    expect(daily("出金:定例(過去の銀行明細)", "2026-11").some((e) => e.date === "2026-11-30" && e.amount === -2_000_000)).toBe(true);
    expect(daily("出金:定例(過去の銀行明細)", "2026-12").some((e) => e.amount === -2_000_000)).toBe(false);
    const cau = out.cases.find((c) => c.id === "cautious")!;
    expect(cau.months[1].byCategory["出金:定例(過去の銀行明細)"]).toBeLessThanOrEqual(-2_000_000);
  });

  it("借入返済は登録済みの予定を数え、同じ分類の合計と同額の定例は重ねない", () => {
    expect(std.months[1].byCategory["出金:借入返済"]).toBe(-1_000_000);
    expect(adj.skippedRecurring).toEqual([expect.objectContaining({ month: "2026-12", reason: "同じ分類の登録済みの支払の合計が同額に近いため" })]);
  });

  it("月末一括振込の一般経費分は直近3か月の平均、下書きの給与明細には経費精算の見込を加える", () => {
    expect(adj.generalBulk).toEqual({ mean: 3_000_000, max: 3_000_000 });
    expect(daily("出金:給与(経費精算の見込)", "2026-12")[0].amount).toBe(-100_000);
  });

  it("原価を取得できたときは、未登録外注を件数・金額とともに記録する(0件なら0円)", () => {
    expect(adj.unregisteredGaichu).toMatchObject({ status: "取得", amount: 0, vendors: 0, lines: 0 });
    expect(out.cases.every((c) => c.missingOutflows === undefined)).toBe(true);
  });

  it("原価を取得できないときは0円ではなく未取得とし、慎重ケースに含められていない支出として示す", () => {
    const o = computeCash({ ...inputs(), sfCosts: null }, [sfSameDay]);
    const a = o.checks.adjustments as { unregisteredGaichu: Record<string, unknown> };
    expect(a.unregisteredGaichu).toMatchObject({ status: "未取得", amount: null, vendors: null });
    const missing = Object.fromEntries(o.cases.map((c) => [c.id, c.missingOutflows?.length ?? 0]));
    expect(missing).toEqual({ standard: 0, cautious: 1, yearEndSlip: 0, cautiousYearEndSlip: 1 });
    expect(o.notes.estimates.some((t) => t.includes("未取得"))).toBe(true);
  });
});
