import { afterEach, describe, expect, it, vi } from "vitest";

const listMonthlyReportsMock = vi.fn();
const listCashPlansMock = vi.fn();
const getMonthlyPlSnapshotMock = vi.fn();
const getMonthlyCashFlowSnapshotMock = vi.fn();

vi.mock("@/repositories/accountingReportRepository", () => ({
  listMonthlyReports: listMonthlyReportsMock,
  listCashPlans: listCashPlansMock,
}));
vi.mock("@/repositories/monthlyPlSnapshotRepository", () => ({ getMonthlyPlSnapshot: getMonthlyPlSnapshotMock }));
vi.mock("@/repositories/monthlyCashFlowSnapshotRepository", () => ({
  getMonthlyCashFlowSnapshot: getMonthlyCashFlowSnapshotMock,
}));

const { getAccountingReportsView } = await import("./accountingReportsService");

afterEach(() => {
  vi.resetAllMocks();
});

// 金額はすべて架空の値
const plan = (targetMonth: string) => ({ targetMonth, values: { checkingSavingsTotal: 600, timeDepositTotal: 300 }, revisions: [] });

describe("getAccountingReportsView", () => {
  it("reads the month-end cash snapshot only for ended months and leaves the registered plans untouched", async () => {
    listMonthlyReportsMock.mockResolvedValue([]);
    listCashPlansMock.mockResolvedValue([plan("2026-11"), plan("2026-10")]);
    getMonthlyCashFlowSnapshotMock.mockResolvedValue({
      cashClosing: 1_005,
      checkingSavingsClosing: 650,
      timeDepositClosing: 350,
      cashOnHandClosing: 5,
      fetchedAt: new Date("2026-11-01T09:00:00Z"),
    });

    const view = await getAccountingReportsView(new Date("2026-11-02T00:00:00Z"));

    expect(getMonthlyCashFlowSnapshotMock).toHaveBeenCalledTimes(1);
    expect(getMonthlyCashFlowSnapshotMock).toHaveBeenCalledWith(2026, 10);
    expect(view.cashPlans.map((c) => [c.plan.targetMonth, c.actual.status])).toEqual([
      ["2026-11", "beforeMonthEnd"],
      ["2026-10", "fetched"],
    ]);
    expect(view.cashPlans[1].plan).toEqual(plan("2026-10"));
  });
});
