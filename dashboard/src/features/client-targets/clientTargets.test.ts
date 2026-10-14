import { describe, expect, it } from "vitest";
import { computeClientTargetProgress, formatSalesRep, type ClientAmountRow, type ClientTargetInput } from "./clientTargets";

const FISCAL_DATES = ["2026-09-01", "2026-10-01", "2026-11-01", "2026-12-01", "2027-01-01", "2027-02-01",
  "2027-03-01", "2027-04-01", "2027-05-01", "2027-06-01", "2027-07-01", "2027-08-01"];

function monthlyTargets(crId: "CR1" | "CR2", clientName: string | null, monthly: number): ClientAmountRow[] {
  return FISCAL_DATES.map((date) => ({ crId, clientName, date, grossProfit: monthly }));
}

function baseInput(overrides: Partial<ClientTargetInput> = {}): ClientTargetInput {
  return {
    crIds: ["CR1", "CR2"],
    currentMonth: 10,
    targets: [],
    completed: [],
    orders: [],
    salesReps: [],
    crAnnualTargets: { CR1: null, CR2: null },
    ...overrides,
  };
}

describe("computeClientTargetProgress", () => {
  it("separates completed/order gross profit up to the current month from the full-year amount", () => {
    const scopes = computeClientTargetProgress(
      baseInput({
        targets: monthlyTargets("CR1", "顧客A", 100),
        completed: [
          { crId: "CR1", clientName: "顧客A", date: "2026-09-20", grossProfit: 50 },
          { crId: "CR1", clientName: "顧客A", date: "2026-10-05", grossProfit: 150 },
          // 当月(10月)より先の請求予定
          { crId: "CR1", clientName: "顧客A", date: "2027-03-31", grossProfit: 100 },
        ],
        orders: [
          { crId: "CR1", clientName: "顧客A", date: "2026-09-01", grossProfit: 400 },
          { crId: "CR1", clientName: "顧客A", date: "2026-11-01", grossProfit: 30 },
        ],
      })
    );
    const row = scopes.find((s) => s.scopeId === "CR1")!.targetedClients[0];

    expect(row.annualTarget).toBe(1200);
    expect(row.completedToDate).toBe(200);
    expect(row.completedFullYear).toBe(300);
    // 年間達成率は当月までの累計完了 ÷ 年間目標
    expect(row.annualRate).toBe(16.7);
    expect(row.monthTarget).toBe(100);
    expect(row.monthCompleted).toBe(150);
    expect(row.monthRate).toBe(150);
    expect(row.orderToDate).toBe(400);
    expect(row.orderFullYear).toBe(430);
  });

  it("treats the whole term as 'to date' when the current month is the fiscal year end", () => {
    const scopes = computeClientTargetProgress(
      baseInput({
        currentMonth: 8,
        completed: [{ crId: "CR1", clientName: "顧客A", date: "2027-08-31", grossProfit: 10 }],
      })
    );
    const cr1 = scopes.find((s) => s.scopeId === "CR1")!.summary;

    expect(cr1.completedToDate).toBe(10);
    expect(cr1.completedFullYear).toBe(10);
  });

  it("separates actuals of clients without a target in the same CR, but keeps them in CR totals", () => {
    const scopes = computeClientTargetProgress(
      baseInput({
        targets: monthlyTargets("CR1", "顧客A", 100),
        completed: [
          { crId: "CR1", clientName: "顧客A", date: "2026-10-01", grossProfit: 100 },
          // 顧客BはCR1に目標が無い
          { crId: "CR1", clientName: "顧客B", date: "2026-10-01", grossProfit: 70 },
          { crId: "CR1", clientName: "顧客B", date: "2027-01-01", grossProfit: 5 },
        ],
      })
    );
    const cr1 = scopes.find((s) => s.scopeId === "CR1")!;

    expect(cr1.targetedClients.map((r) => r.clientName)).toEqual(["顧客A"]);
    expect(cr1.untargetedClients.map((r) => [r.kind, r.clientName])).toEqual([["untargeted", "顧客B"]]);
    expect(cr1.summary.completedToDate).toBe(170);
    expect(cr1.summary.untargetedCompletedToDate).toBe(70);
    expect(cr1.summary.untargetedCompletedFullYear).toBe(75);
  });

  it("keeps client-less targets as unallocated targets, separate from client targets but inside the annual target", () => {
    const scopes = computeClientTargetProgress(
      baseInput({
        targets: [...monthlyTargets("CR1", "顧客A", 100), ...monthlyTargets("CR1", null, 50)],
        // クライアント名なしの実績は未配分目標には紐づけず、目標未設定の実績として扱う
        completed: [{ crId: "CR1", clientName: null, date: "2026-10-01", grossProfit: 20 }],
      })
    );
    const cr1 = scopes.find((s) => s.scopeId === "CR1")!;

    expect(cr1.targetedClients.map((r) => r.clientName)).toEqual(["顧客A"]);
    expect(cr1.unallocatedTargets.map((r) => [r.kind, r.annualTarget, r.completedToDate])).toEqual([
      ["unallocated", 600, 0],
    ]);
    expect(cr1.untargetedClients.map((r) => [r.clientName, r.completedToDate])).toEqual([[null, 20]]);
    expect(cr1.summary.clientTarget).toBe(1200);
    expect(cr1.summary.unallocatedTarget).toBe(600);
    expect(cr1.summary.annualTarget).toBe(1800);
    expect(cr1.summary.monthTarget).toBe(150);
  });

  it("shows the gap between SalesTarget__c CR targets and the annual target", () => {
    const scopes = computeClientTargetProgress(
      baseInput({
        targets: [...monthlyTargets("CR1", "顧客A", 100), ...monthlyTargets("CR1", null, 10), ...monthlyTargets("CR2", "顧客B", 10)],
        crAnnualTargets: { CR1: 2000, CR2: 120 },
      })
    );

    expect(scopes.find((s) => s.scopeId === "CR1")!.summary.crTargetGap).toBe(680);
    expect(scopes.find((s) => s.scopeId === "CR2")!.summary.crTargetGap).toBe(0);
    const all = scopes.find((s) => s.scopeId === "ALL")!.summary;
    expect(all.crAnnualTarget).toBe(2120);
    expect(all.crTargetGap).toBe(680);
  });

  it("returns null for the company-wide CR target when any CR target is missing", () => {
    const all = computeClientTargetProgress(baseInput({ crAnnualTargets: { CR1: 2000, CR2: null } })).find(
      (s) => s.scopeId === "ALL"
    )!.summary;

    expect(all.crAnnualTarget).toBeNull();
    expect(all.crTargetGap).toBeNull();
  });

  it("orders targeted clients by annual target across CRs, keeping the same client separate per CR", () => {
    const scopes = computeClientTargetProgress(
      baseInput({
        targets: [
          ...monthlyTargets("CR2", "顧客A", 500),
          ...monthlyTargets("CR1", "顧客A", 100),
          ...monthlyTargets("CR1", "顧客C", 200),
        ],
      })
    );
    const all = scopes.find((s) => s.scopeId === "ALL")!;

    expect(all.targetedClients.map((r) => [r.crId, r.clientName])).toEqual([
      ["CR2", "顧客A"],
      ["CR1", "顧客C"],
      ["CR1", "顧客A"],
    ]);
  });

  it("computes the monthly order achievement against the current month target", () => {
    const row = computeClientTargetProgress(
      baseInput({
        targets: monthlyTargets("CR1", "顧客A", 200),
        orders: [
          { crId: "CR1", clientName: "顧客A", date: "2026-10-03", grossProfit: 50 },
          { crId: "CR1", clientName: "顧客A", date: "2026-09-03", grossProfit: 999 },
        ],
      })
    ).find((s) => s.scopeId === "CR1")!.targetedClients[0];

    expect(row.monthTarget).toBe(200);
    expect(row.monthOrder).toBe(50);
    expect(row.monthOrderRate).toBe(25);
  });

  it("assigns the sales rep with the largest gross profit per CR × client, not to unallocated targets", () => {
    const scopes = computeClientTargetProgress(
      baseInput({
        targets: [...monthlyTargets("CR1", "顧客A", 100), ...monthlyTargets("CR1", null, 10), ...monthlyTargets("CR2", "顧客A", 100)],
        salesReps: [
          { crId: "CR1", clientName: "顧客A", salesRepName: "佐藤", grossProfit: 30 },
          { crId: "CR1", clientName: "顧客A", salesRepName: "鈴木", grossProfit: 50 },
          { crId: "CR1", clientName: "顧客A", salesRepName: "佐藤", grossProfit: 30 },
          // 他CRの案件は数えない
          { crId: "CR2", clientName: "顧客A", salesRepName: "高橋", grossProfit: 1 },
          { crId: "CR1", clientName: null, salesRepName: "伊藤", grossProfit: 1 },
        ],
      })
    );
    const cr1 = scopes.find((s) => s.scopeId === "CR1")!;

    expect(cr1.targetedClients[0].salesRep).toBe("佐藤 他1名");
    expect(cr1.unallocatedTargets[0].salesRep).toBeNull();
    expect(scopes.find((s) => s.scopeId === "CR2")!.targetedClients[0].salesRep).toBe("高橋");
  });

  it("formats sales reps deterministically and returns null without deals", () => {
    expect(formatSalesRep(undefined)).toBeNull();
    expect(formatSalesRep(new Map([["B", 10], ["A", 10]]))).toBe("A 他1名");
  });

  it("builds a 12-month trend in fiscal order with cumulative values and future flags", () => {
    const monthly = computeClientTargetProgress(
      baseInput({
        targets: monthlyTargets("CR1", "顧客A", 100),
        completed: [
          { crId: "CR1", clientName: "顧客A", date: "2026-09-10", grossProfit: 80 },
          { crId: "CR1", clientName: "顧客A", date: "2026-10-10", grossProfit: 30 },
        ],
      })
    ).find((s) => s.scopeId === "ALL")!.monthly;

    expect(monthly.map((m) => m.month)).toEqual([9, 10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(monthly[1]).toEqual({
      month: 10,
      isFuture: false,
      target: 100,
      completed: 30,
      order: 0,
      cumulativeTarget: 200,
      cumulativeCompleted: 110,
    });
    expect(monthly[2].isFuture).toBe(true);
  });

  it("treats null gross profit as 0 and returns null rates when the target is 0", () => {
    const cr2 = computeClientTargetProgress(
      baseInput({ completed: [{ crId: "CR2", clientName: "顧客C", date: "2026-10-01", grossProfit: null }] })
    ).find((s) => s.scopeId === "CR2")!.summary;

    expect(cr2.completedToDate).toBe(0);
    expect(cr2.annualRate).toBeNull();
    expect(cr2.monthRate).toBeNull();
  });
});
