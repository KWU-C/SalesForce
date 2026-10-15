import { describe, expect, it } from "vitest";
import { computeFocusClients, type FocusClientMaster, type FocusDeal } from "./focusClients";

const TERM_RANGE = { start: "2026-09-01", end: "2027-08-31" };

function master(accountId: string, targets: FocusClientMaster["targets"] = {}): FocusClientMaster {
  return {
    accountId,
    name: `顧客${accountId}`,
    category: "注力",
    theme: "",
    owner: "",
    strategy: "",
    currentStatus: "",
    monthAction: "",
    nextAction: "",
    targets,
    updatedBy: null,
    updatedAt: null,
  };
}

function deal(overrides: Partial<FocusDeal>): FocusDeal {
  return {
    id: "d1",
    accountId: "A",
    name: "案件",
    phase: "入金",
    confidence: "A (80～100%)",
    crId: "CR1",
    salesRep: null,
    sales: 0,
    grossProfit: 0,
    orderDate: null,
    invoiceDate: null,
    plannedSalesDate: null,
    lostReason: null,
    ...overrides,
  };
}

function compute(masters: FocusClientMaster[], deals: FocusDeal[], currentMonth = 10) {
  return computeFocusClients({ term: 50, termRange: TERM_RANGE, currentMonth, masters, deals });
}

describe("computeFocusClients", () => {
  it("lists every focus client, including ones with no deals, with blank targets as null rates", () => {
    const { rows } = compute([master("A"), master("B", { "50": { sales: 1000, grossProfit: 500 } })], []);

    expect(rows.map((r) => r.master.accountId)).toEqual(["A", "B"]);
    expect(rows[0].grossProfitRate).toBeNull();
    expect(rows[0].target).toEqual({ sales: null, grossProfit: null });
    expect(rows[1].grossProfitRate).toBe(0);
  });

  it("treats a 0-yen target the same as no target (rate shown as ―)", () => {
    const { rows } = compute([master("A", { "50": { sales: 0, grossProfit: 0 } })], [
      deal({ invoiceDate: "2026-09-10", grossProfit: 100 }),
    ]);
    expect(rows[0].grossProfitRate).toBeNull();
    expect(rows[0].salesRate).toBeNull();
  });

  it("uses only the selected term's target", () => {
    const { rows } = compute([master("A", { "49": { sales: 1, grossProfit: 1 } })], []);
    expect(rows[0].target).toEqual({ sales: null, grossProfit: null });
  });

  it("splits completed amounts into to-date and full-year by invoice date, and orders by order date", () => {
    const { rows } = compute(
      [master("A", { "50": { sales: 10000, grossProfit: 1000 } })],
      [
        deal({ id: "1", invoiceDate: "2026-09-15", orderDate: "2026-09-01", sales: 3000, grossProfit: 300 }),
        deal({ id: "2", invoiceDate: "2026-10-31", sales: 1000, grossProfit: 100 }),
        // 当月(10月)より先の請求予定: 通年にだけ入る
        deal({ id: "3", phase: "受注", invoiceDate: "2027-02-01", orderDate: "2026-10-01", sales: 2000, grossProfit: 200 }),
        // 前期に請求済み: 完了に入らない
        deal({ id: "4", invoiceDate: "2026-08-31", orderDate: "2026-11-01", sales: 9, grossProfit: 9 }),
      ]
    );
    const row = rows[0];
    expect(row.completedSalesToDate).toBe(4000);
    expect(row.completedGrossProfitToDate).toBe(400);
    expect(row.completedGrossProfitFullYear).toBe(600);
    // 11月受注は当月より先なので累計受注に入らない
    expect(row.orderGrossProfitToDate).toBe(500);
    expect(row.grossProfitRate).toBe(40);
    expect(row.salesRate).toBe(40);
  });

  it("excludes lost deals and non-A confidence from actuals but keeps them in the deal list", () => {
    const { rows } = compute(
      [master("A")],
      [
        deal({ id: "lost", phase: "失注", invoiceDate: "2026-09-10", grossProfit: 999, lostReason: "価格" }),
        deal({ id: "b", confidence: "B (50～80%未満)", invoiceDate: "2026-09-10", grossProfit: 888 }),
        deal({ id: "open", phase: "提案", confidence: "C (新規問い合わせ)", sales: 50, grossProfit: 20 }),
      ]
    );
    const row = rows[0];
    expect(row.completedGrossProfitToDate).toBe(0);
    expect(row.lostCount).toBe(1);
    expect(row.openCount).toBe(1);
    expect(row.openGrossProfit).toBe(20);
    expect(row.deals.map((d) => d.id)).toEqual(["open", "b", "lost"]);
  });

  it("attributes deals by account ID only and de-duplicates by deal ID", () => {
    const { rows } = compute(
      [master("A"), master("B")],
      [
        deal({ id: "1", accountId: "B", invoiceDate: "2026-09-10", grossProfit: 100 }),
        deal({ id: "1", accountId: "B", invoiceDate: "2026-09-10", grossProfit: 100 }),
        deal({ id: "2", accountId: "Z", invoiceDate: "2026-09-10", grossProfit: 100 }),
      ]
    );
    expect(rows[0].completedGrossProfitToDate).toBe(0);
    expect(rows[1].completedGrossProfitToDate).toBe(100);
    expect(rows[1].deals).toHaveLength(1);
  });

  it("computes summary rates only over clients that have a target", () => {
    const { summary } = compute(
      [master("A", { "50": { sales: null, grossProfit: 1000 } }), master("B")],
      [
        deal({ id: "1", accountId: "A", invoiceDate: "2026-09-10", grossProfit: 500 }),
        deal({ id: "2", accountId: "B", invoiceDate: "2026-09-10", grossProfit: 700 }),
      ]
    );
    expect(summary.clientCount).toBe(2);
    expect(summary.targetedCount).toBe(1);
    expect(summary.completedGrossProfitToDate).toBe(1200);
    expect(summary.grossProfitRate).toBe(50);
    expect(summary.salesRate).toBeNull();
  });
});
