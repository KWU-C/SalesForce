import { describe, expect, it } from "vitest";
import { ChangeTypeRequiredError, listCashPlans, saveAccountingReport } from "./accountingReportRepository";
import type { AccountingReportStore } from "./accountingReportRepository";
import type { CashPlanValues, MonthlyReportValues } from "@/features/management-dashboard/accountingReports";

function memoryStore(): AccountingReportStore & { docs: Map<string, unknown> } {
  const docs = new Map<string, unknown>();
  return {
    docs,
    async listAll(kind) {
      return [...docs.entries()].filter(([k]) => k.startsWith(kind)).map(([, v]) => v);
    },
    async readModifyWrite(kind, targetMonth, update) {
      const key = `${kind}/${targetMonth}`;
      const next = update(docs.get(key) ?? null);
      docs.set(key, next);
      return next;
    },
  };
}

const plan = (bonusReserve: number, sourceUpdatedOn: string): CashPlanValues => ({
  checkingSavingsTotal: 100,
  timeDepositTotal: 10,
  collateralDeduction: 50,
  depositTotalAfterCollateral: 60,
  consumptionTaxReserve: 5,
  bonusReserve,
  checkingSavingsAfterReserves: 100 - 5 - bonusReserve,
  depositTotalAfterReserves: 60 - 5 - bonusReserve,
  sourceUpdatedOn,
  documentName: "資金繰り",
  note: null,
});

const T1 = new Date("2026-10-15T01:00:00Z");
const T2 = new Date("2026-10-20T01:00:00Z");

describe("saveAccountingReport", () => {
  it("registers a new month as an initial entry with system registration time", async () => {
    const store = memoryStore();
    const saved = await saveAccountingReport(
      { kind: "cash-plan", targetMonth: "2026-10", values: plan(12, "2026-10-14"), updatedBy: "a@tcd.jp", now: T1 },
      store
    );
    expect(saved).toMatchObject({
      targetMonth: "2026-10",
      changeType: "initial",
      createdBy: "a@tcd.jp",
      createdAt: T1.toISOString(),
      revisions: [],
    });
  });

  it("requires a reason to overwrite and keeps the previous values, updater, time and document date in history", async () => {
    const store = memoryStore();
    await saveAccountingReport(
      { kind: "cash-plan", targetMonth: "2026-10", values: plan(12, "2026-10-14"), updatedBy: "a@tcd.jp", now: T1 },
      store
    );
    await expect(
      saveAccountingReport({ kind: "cash-plan", targetMonth: "2026-10", values: plan(13, "2026-10-20"), updatedBy: "b@tcd.jp" }, store)
    ).rejects.toBeInstanceOf(ChangeTypeRequiredError);

    const saved = await saveAccountingReport(
      {
        kind: "cash-plan",
        targetMonth: "2026-10",
        values: plan(13, "2026-10-20"),
        changeType: "forecastUpdate",
        updatedBy: "b@tcd.jp",
        now: T2,
      },
      store
    );
    expect(saved.values.bonusReserve).toBe(13);
    expect(saved.changeType).toBe("forecastUpdate");
    expect(saved.createdAt).toBe(T1.toISOString());
    expect(saved.revisions).toEqual([
      {
        values: plan(12, "2026-10-14"),
        previousUpdatedBy: "a@tcd.jp",
        previousUpdatedAt: T1.toISOString(),
        changeType: "forecastUpdate",
        changedBy: "b@tcd.jp",
        changedAt: T2.toISOString(),
      },
    ]);
    expect((await listCashPlans(store)).map((p) => p.targetMonth)).toEqual(["2026-10"]);
  });

  it("does not allow a forecast update on a monthly report (actuals can only be corrected)", async () => {
    const store = memoryStore();
    const values: MonthlyReportValues = {
      revenueCumulative: 100,
      ordinaryProfitCumulative: -1,
      prevYearRevenueCumulative: null,
      prevYearOrdinaryProfitCumulative: null,
      basisDate: "2026-09-30",
      reportDate: null,
      documentName: "経理報告",
      differenceExplanation: null,
      note: null,
    };
    await saveAccountingReport({ kind: "monthly-report", targetMonth: "2026-09", values, updatedBy: "a@tcd.jp" }, store);
    await expect(
      saveAccountingReport(
        { kind: "monthly-report", targetMonth: "2026-09", values, changeType: "forecastUpdate", updatedBy: "a@tcd.jp" },
        store
      )
    ).rejects.toBeInstanceOf(ChangeTypeRequiredError);
    const corrected = await saveAccountingReport(
      { kind: "monthly-report", targetMonth: "2026-09", values: { ...values, note: "訂正" }, changeType: "correction", updatedBy: "a@tcd.jp" },
      store
    );
    expect(corrected.revisions).toHaveLength(1);
    expect(corrected.revisions[0].changeType).toBe("correction");
  });
});
