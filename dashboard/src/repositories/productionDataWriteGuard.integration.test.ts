import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProductionDataWriteBlockedError } from "@/services/firestore/productionDataWriteGuard";

// 書き込みガードより先にFirestoreへ触れたら失敗にする
const firestoreTouched = vi.fn();
vi.mock("@/services/firestore/firestoreClient", () => ({
  getFirestoreClient: () => {
    firestoreTouched();
    throw new Error("Firestore must not be reached");
  },
}));

const { saveMonthlyCashFlowSnapshot } = await import("./monthlyCashFlowSnapshotRepository");
const { saveMonthlyPlSnapshot } = await import("./monthlyPlSnapshotRepository");
const { saveFundReserveSnapshot } = await import("./fundReserveSnapshotRepository");
const { saveLoanStatusSnapshot } = await import("./loanStatusSnapshotRepository");
const { saveFinancialSummarySnapshot } = await import("./financialSummarySnapshotRepository");
const { saveTermCashFlowSnapshot } = await import("./termCashFlowSnapshotRepository");
const { saveProcessMemo } = await import("./processMemoRepository");
const { saveAccountingReport } = await import("./accountingReportRepository");

const ORIGINAL = { ...process.env };

beforeEach(() => {
  firestoreTouched.mockReset();
});
afterEach(() => {
  process.env = { ...ORIGINAL };
});

// 引数の中身はガードで止まるため使われない
const writes: [string, () => Promise<unknown>][] = [
  ["monthlyCashFlowSnapshots", () => saveMonthlyCashFlowSnapshot({ fiscalYear: 2026, month: 10 } as never)],
  ["monthlyPlSnapshots", () => saveMonthlyPlSnapshot({ fiscalYear: 2026, month: 10 } as never)],
  ["fundReserveSnapshots", () => saveFundReserveSnapshot({ fiscalYear: 2026, month: 10 } as never)],
  ["loanStatusSnapshots", () => saveLoanStatusSnapshot({ fiscalYear: 2026, month: 10 } as never)],
  ["financialSummarySnapshots", () => saveFinancialSummarySnapshot({ fiscalYear: 2026, month: 10 } as never)],
  ["termCashFlowSnapshots", () => saveTermCashFlowSnapshot({ term: 50 } as never)],
  ["processMemos", () => saveProcessMemo({ processId: "a0X000000000001", crId: "CR1", updatedBy: "tester@example.com" } as never)],
  ["cashPlanForecasts", () => saveAccountingReport({ kind: "cash-plan", targetMonth: "2026-10", values: {}, updatedBy: "tester@example.com" } as never)],
];

describe("本番データの書き込みはdev2では止まる(Firestoreに触れない)", () => {
  it.each(writes)("%s", async (_name, write) => {
    process.env.K_SERVICE = "tcd-dashboard-dev2";
    delete process.env.CLOUD_RUN_JOB;
    await expect(write()).rejects.toBeInstanceOf(ProductionDataWriteBlockedError);
    expect(firestoreTouched).not.toHaveBeenCalled();
  });

  it.each(writes)("%s: 本番サービスではガードを通過する(この後のFirestore呼び出しはモック)", async (_name, write) => {
    process.env.K_SERVICE = "tcd-dashboard-prod";
    await expect(write()).rejects.toThrow("Firestore must not be reached");
    expect(firestoreTouched).toHaveBeenCalled();
  });
});
