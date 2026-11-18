import { describe, expect, it } from "vitest";
import { computeUnregisteredGaichu } from "./unregisteredGaichu";
import type { RfDeal, RfSfCost } from "./types";

// 金額・取引先はすべて架空
let seq = 1;
const deal = (partnerId: number, issueDate: string, amount: number, dueDate: string | null = null, account = "[製]外注加工費"): RfDeal => ({
  id: seq++,
  type: "expense",
  issueDate,
  dueDate,
  amount,
  dueAmount: 0,
  partnerId,
  details: [{ accountName: account, amount, description: "" }],
  payments: [],
});
const cost = (vendorName: string, purchaseDate: string, amountTaxIncluded: number, extra: Partial<RfSfCost> = {}): RfSfCost => ({ vendorName, purchaseDate, amountTaxIncluded, ...extra });
const partners = new Map([
  [1, "株式会社アルファ"],
  [2, "ベータ合同会社"],
  [3, "ガンマ"],
  [4, "デルタ"],
]);
const run = (sfCosts: RfSfCost[], deals: RfDeal[], termsReadable = true) =>
  computeUnregisteredGaichu({ month: "2026-10", baseDate: "2026-11-18", sfCosts, termsReadable, expenseDeals: deals, partners });

describe("未登録外注の照合(同じ仕入月が基本)", () => {
  it("同じ仕入月のfreee取引で消し込み、足りない分だけを未登録とする", () => {
    const r = run([cost("アルファ", "2026-10-20", 500_000), cost("アルファ", "2026-10-25", 100_000)], [deal(1, "2026-10-31", 550_000, "2026-11-30")]);
    expect(r.status).toBe("取得");
    expect(r.items).toEqual([expect.objectContaining({ vendor: "U01", sfAmount: 600_000, freeeSameMonth: 550_000, unregistered: 50_000 })]);
  });

  it("前後の月のfreee取引は、同じ支払先というだけでは差し引かない(金額が違えば未照合のまま)", () => {
    const r = run([cost("ベータ", "2026-10-27", 371_800)], [deal(2, "2026-09-30", 132_000, "2026-10-31")]);
    expect(r.items[0]).toMatchObject({ unregistered: 371_800, freeeAdjacentConfirmed: [], freeeAdjacentNotDeducted: [{ issueDate: "2026-09-30", amount: 132_000 }] });
  });

  it("前後の月のfreee取引は、未照合の原価と金額が一致し、発生月に同額の原価が無いときだけ同一の支払として差し引く", () => {
    const ok = run([cost("ガンマ", "2026-10-30", 220_000)], [deal(3, "2026-11-02", 220_000, "2026-11-30")]);
    expect(ok.items).toEqual([]);
    expect(ok.amount).toBe(0);
    // 発生月(11月)に同額の原価があれば、その月の分として差し引かない
    const own = run([cost("ガンマ", "2026-10-30", 220_000), cost("ガンマ", "2026-11-05", 220_000)], [deal(3, "2026-11-06", 220_000, "2026-12-31")]);
    expect(own.items[0]).toMatchObject({ unregistered: 220_000, freeeAdjacentNotDeducted: [{ issueDate: "2026-11-06", amount: 220_000 }] });
  });

  it("原価以外の科目(福利厚生費など)のfreee取引は照合に使わない", () => {
    const r = run([cost("アルファ", "2026-10-20", 300_000)], [deal(1, "2026-10-31", 300_000, "2026-11-30", "福利厚生費")]);
    expect(r.items[0].unregistered).toBe(300_000);
  });
});

describe("未登録外注の支払日(推定と根拠)", () => {
  it("Salesforceの支払予定日を最優先にする", () => {
    const r = run([cost("アルファ", "2026-10-20", 100_000, { paymentDueDate: "2026-12-10", vendorTerms: { closing: "末日", pattern: "下）翌月末振込", holiday: "翌営業日" } })], []);
    expect(r.items[0]).toMatchObject({ payDate: "2026-12-10", payDateBasis: expect.stringContaining("支払予定日") });
  });

  it("次に支払先の支払パターン(翌々月10日・翌月末)と休日の取扱いを使う", () => {
    const r = run([cost("アルファ", "2026-10-20", 100_000, { vendorTerms: { closing: "末日", pattern: "一）翌々月10日振込", holiday: "翌営業日" } })], []);
    expect(r.items[0]).toMatchObject({ payDate: "2026-12-10", payDateBasis: expect.stringContaining("翌々月10日") });
    // 2027-01-10(日)・11(祝)は休業日。前営業日なら1/8(金)
    const r2 = computeUnregisteredGaichu({
      month: "2026-11",
      baseDate: "2026-12-16",
      sfCosts: [cost("アルファ", "2026-11-20", 100_000, { vendorTerms: { closing: "末日", pattern: "一）翌々月10日振込", holiday: "前営業日" } })],
      termsReadable: true,
      expenseDeals: [],
      partners,
    });
    expect(r2.items[0].payDate).toBe("2027-01-08");
  });

  it("支払条件が読めなければfreeeの同じ支払先の直近の型、それも無ければ翌月末", () => {
    const r = run([cost("デルタ", "2026-10-15", 80_000), cost("ガンマ", "2026-10-15", 60_000)], [deal(4, "2026-09-30", 50_000, "2026-11-10")], false);
    const byAmount = Object.fromEntries(r.items.map((x) => [x.sfAmount, x]));
    expect(byAmount[80_000]).toMatchObject({ payDate: "2026-12-10", payDateBasis: expect.stringContaining("2か月後の10日") });
    expect(byAmount[60_000]).toMatchObject({ payDate: "2026-11-30", payDateBasis: expect.stringContaining("既定") });
    expect(r.termsReadable).toBe(false);
  });

  it("推定の期日が基準日以前なら、基準日の翌営業日に置き、その旨を記録する", () => {
    const r = run([cost("アルファ", "2026-10-20", 100_000, { paymentDueDate: "2026-11-10" })], []);
    expect(r.items[0]).toMatchObject({ payDate: "2026-11-19", payDateBasis: expect.stringContaining("基準日の翌営業日") });
  });

  it("原価を取得できなければ未取得(0円ではない)", () => {
    const r = computeUnregisteredGaichu({ month: "2026-10", baseDate: "2026-11-18", sfCosts: null, termsReadable: false, expenseDeals: [], partners });
    expect(r).toMatchObject({ status: "未取得", amount: null, items: [] });
  });
});
