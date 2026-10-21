import { describe, expect, it, vi } from "vitest";
import { CASH_FORECAST_SETTINGS } from "@/config/cashForecastSettings";

vi.mock("@/repositories/freeeAuthRepository", () => ({
  getFreeeCompanyId: async () => {
    throw new Error("the real freee connection must not be used");
  },
}));
vi.mock("@/repositories/monthlyCashFlowSnapshotRepository", () => ({
  getMonthlyCashFlowSnapshot: async () => {
    throw new Error("the real Firestore must not be used");
  },
}));

const { collectForecastInputs, toMonthActual } = await import("./cashForecastInputs");
const { FreeeReadError } = await import("@/services/freee/freeeForecastClient");

// 金額はすべて架空の値
function snapshot(fiscalYear: number, month: number, withBreakdown = true) {
  return {
    fiscalYear,
    month,
    cashOpening: 1000,
    cashClosing: 1100,
    timeDepositClosing: 300,
    cashOnHandClosing: 5,
    inflow: withBreakdown ? { operating: 500 } : undefined,
    outflow: withBreakdown
      ? { labor: 100, outsourcing: 50, otherOperating: 40, other: 5, taxSocial: 20, financing: 10, interest: 1, assetTransfer: 3 }
      : undefined,
    fetchedAt: new Date("2026-10-21T09:00:00Z"),
  } as never;
}

function client(overrides: Record<string, unknown> = {}) {
  return {
    listAccountItemNames: vi.fn(async () => new Map([[1, "売上高"]])),
    listDeals: vi.fn(async (_c: number, q: { status?: string }) => (q.status === "unsettled" ? [{ id: 1 }, { id: 2 }] : [{ id: 2 }, { id: 3 }]) as never),
    getPayrollMonth: vi.fn(async (_c: number, kind: string, y: number, m: number) =>
      kind === "salary" ? ({ kind, month: `${y}-${String(m).padStart(2, "0")}`, netTotal: 300, payDate: "x", statementCount: 1, fixedCount: 1 } as never) : null
    ),
    getMonthEndAccountBalances: vi.fn(async () => ({ 未払法人税等: 0, 未払消費税等: 0 })),
    listWalletTxns: vi.fn(async () => [
      { date: "2026-10-20", entrySide: "expense", amount: 9, dueAmount: 9, status: 1, walletableType: "bank_account", walletableId: 1 },
      { date: "2026-10-20", entrySide: "expense", amount: 9, dueAmount: 0, status: 2, walletableType: "bank_account", walletableId: 1 },
      { date: "2026-10-20", entrySide: "expense", amount: 9, dueAmount: 9, status: 1, walletableType: "credit_card", walletableId: 2 },
    ]),
    listWalletables: vi.fn(async () => [
      { id: 10, name: "普通預金_銀行A", type: "bank_account", lastSyncDate: "2026-10-20" },
      { id: 11, name: "定期預金_銀行A", type: "bank_account", lastSyncDate: "2026-10-01" },
    ]),
    listTransfers: vi.fn(async () => []),
    ...overrides,
  } as never;
}

describe("collectForecastInputs", () => {
  it("collects every source, keeps only unprocessed bank txns, and finds time-deposit accounts", async () => {
    const c = client();
    const { inputs, currentMonthSnapshotFetchedAt } = await collectForecastInputs("2026-10-21", CASH_FORECAST_SETTINGS, {
      getCompanyId: async () => 1,
      getSnapshot: async (fy, m) => snapshot(fy, m),
      client: c,
    });
    expect(inputs.failures).toEqual([]);
    expect(Object.keys(inputs.actuals)).toEqual(["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);
    expect(inputs.currentMonthToDate).toMatchObject({ inflowOperating: 500, labor: 100 });
    expect(currentMonthSnapshotFetchedAt).toBe("2026-10-21T09:00:00.000Z");
    expect(inputs.deals.map((d) => d.id).sort()).toEqual([1, 2, 3]);
    expect(inputs.unbookedBankTxns).toHaveLength(1);
    expect(inputs.timeDepositWalletableIds).toEqual([11]);
    // 給与明細は過去6か月〜翌月(8か月)、賞与明細は予測期間内の支給月(12月)だけ
    const calls = (c as { getPayrollMonth: { mock: { calls: unknown[][] } } }).getPayrollMonth.mock.calls;
    expect(calls.filter((x) => x[1] === "salary")).toHaveLength(8);
    expect(calls.filter((x) => x[1] === "bonus").map((x) => `${x[2]}-${x[3]}`)).toEqual(["2026-12"]);
    expect(inputs.liabilities).toEqual({ asOfMonth: "2026-09", balances: { 未払法人税等: 0, 未払消費税等: 0 } });
  });

  it("records the kind of a failed source instead of returning empty data", async () => {
    const c = client({
      listDeals: vi.fn(async () => {
        throw new FreeeReadError("deals", "forbidden", 403);
      }),
      listWalletables: vi.fn(async () => {
        throw new Error("network");
      }),
    });
    const { inputs } = await collectForecastInputs("2026-10-21", CASH_FORECAST_SETTINGS, { getCompanyId: async () => 1, getSnapshot: async (fy, m) => snapshot(fy, m), client: c });
    expect(inputs.failures).toEqual(expect.arrayContaining([{ source: "deals", kind: "forbidden" }, { source: "walletables", kind: "other" }]));
  });

  it("fails as not connected when freee is not connected, without calling freee", async () => {
    const c = client();
    const { inputs } = await collectForecastInputs("2026-10-21", CASH_FORECAST_SETTINGS, { getCompanyId: async () => null, getSnapshot: async () => null, client: c });
    expect(inputs.failures).toEqual([{ source: "freee_connection", kind: "not_connected" }]);
    expect((c as { listDeals: { mock: { calls: unknown[] } } }).listDeals.mock.calls).toHaveLength(0);
  });

  it("does not use months saved by the old logic without category breakdowns", () => {
    expect(toMonthActual(snapshot(2026, 9, false))).toBeNull();
  });
});
