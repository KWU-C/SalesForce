import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MonthlyCashFlow } from "./types";

/**
 * 資金繰り予定の実績欄が、月末後の定時更新だけで「月末前 → 未取得 → 実績」に切り替わることの通し確認。
 * 定時更新(refreshPastCashFlows)・月次資金収支の計算(computeMonthlyCashFlow)・表示データ
 * (getAccountingReportsView)は本物を使い、freee APIとFirestoreだけをメモリ上の偽物にする。
 * 金額はすべて架空の値。
 */

const snapshots = new Map<string, MonthlyCashFlow>();
const trialBsByMonth = new Map<number, unknown[]>();
const savePlanMock = vi.fn();

vi.mock("@/repositories/freeeAuthRepository", () => ({ getFreeeCompanyId: async () => 1 }));
vi.mock("@/repositories/monthlyCashFlowSnapshotRepository", () => ({
  getMonthlyCashFlowSnapshot: async (fy: number, month: number) => snapshots.get(`${fy}-${month}`) ?? null,
  // 本物と同じくmerge保存(既存ドキュメントに新しい項目が書き足される)
  saveMonthlyCashFlowSnapshot: async (s: MonthlyCashFlow) => {
    const key = `${s.fiscalYear}-${s.month}`;
    snapshots.set(key, { ...snapshots.get(key), ...s });
  },
}));
vi.mock("@/repositories/monthlyPlSnapshotRepository", () => ({ getMonthlyPlSnapshot: async () => null }));
vi.mock("@/repositories/accountingReportRepository", () => ({
  listMonthlyReports: async () => [],
  listCashPlans: async () => [plan("2026-11"), plan("2026-10")],
  saveAccountingReport: savePlanMock,
}));
vi.mock("./termCashFlowTotalService", () => ({ getOrComputeTermCashFlowTotal: async () => null }));
vi.mock("@/services/freee/freeeJournalsClient", () => ({ getJournalsCsv: async () => "" }));
vi.mock("@/services/freee/freeeAccountingClient", () => ({
  getTrialBs: async (_c: number, p: { endMonth: number }) => ({ balances: trialBsByMonth.get(p.endMonth) ?? [] }),
}));
vi.mock("@/services/freee/freeeTransactionClient", () => ({
  getWalletTxns: async () => [],
  getAccountItems: async () => [],
  getWalletables: async () => [],
}));

const { refreshPastCashFlows } = await import("./refreshPastCashFlows");
const { getAccountingReportsView } = await import("./accountingReportsService");
const { actualKindsDifference, compareCashPlan } = await import("./accountingReports");

function plan(targetMonth: string) {
  return {
    targetMonth,
    values: { checkingSavingsTotal: 3_100, timeDepositTotal: 300, documentName: "資金繰り表(架空)" },
    changeType: "initial",
    revisions: [],
  };
}

function cashLeaf(name: string, closing: number) {
  return { account_item_name: name, account_category_name: "現金・預金", opening_balance: 0, closing_balance: closing };
}

/** 10月分の古いスナップショット(種類別の項目を追加する前の保存分、10/21取得) */
function seedOldOctoberSnapshot() {
  snapshots.set("2026-10", {
    fiscalYear: 2026,
    month: 10,
    cashOpening: 0,
    cashClosing: 3_305,
    cashChange: 3_305,
    fetchedAt: new Date("2026-10-21T09:00:00Z"),
  } as MonthlyCashFlow);
}

async function statuses(now: string) {
  const view = await getAccountingReportsView(new Date(now));
  return Object.fromEntries(view.cashPlans.map((c) => [c.plan.targetMonth, c.actual.status]));
}

/** 定時更新(毎日18:00 JST)の当期過去月の取り直しを、指定時刻に実行する */
async function runScheduledRefreshAt(iso: string, currentMonth: number) {
  vi.setSystemTime(new Date(iso));
  await refreshPastCashFlows(50, currentMonth);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  snapshots.clear();
  trialBsByMonth.clear();
});

afterEach(() => {
  vi.useRealTimers();
  savePlanMock.mockReset();
});

describe("資金繰り予定の実績欄の自動切り替え(定時更新のみ、手動更新なし)", () => {
  it("月末前 → 月末後・定時更新前は未取得 → 定時更新後に実績と差額が出る", async () => {
    seedOldOctoberSnapshot();
    trialBsByMonth.set(9, [cashLeaf("普通預金_銀行B", 1)]);
    trialBsByMonth.set(10, [
      cashLeaf("当座預金_銀行A", 1_000),
      cashLeaf("普通預金_銀行B", 2_000),
      cashLeaf("定期預金_銀行A", 300),
      cashLeaf("現金", 5),
    ]);

    // 現在(10/21): 10月・11月とも月末前
    expect(await statuses("2026-10-21T03:00:00Z")).toEqual({ "2026-11": "beforeMonthEnd", "2026-10": "beforeMonthEnd" });

    // 11/1 10:00 JST(定時更新前): 10月は月末後だが、保存済みは月末前取得・項目追加前なので未取得(0円にしない)
    expect(await statuses("2026-11-01T01:00:00Z")).toEqual({ "2026-11": "beforeMonthEnd", "2026-10": "notFetched" });

    // 11/1 18:00 JST の定時更新: 当期の過去月(9・10月)を取り直す
    await runScheduledRefreshAt("2026-11-01T09:00:00Z", 11);
    expect(snapshots.get("2026-10")).toMatchObject({
      checkingSavingsClosing: 3_000,
      timeDepositClosing: 300,
      cashOnHandClosing: 5,
      cashClosing: 3_305,
    });

    const view = await getAccountingReportsView(new Date("2026-11-01T10:00:00Z"));
    const october = view.cashPlans.find((c) => c.plan.targetMonth === "2026-10")!;
    expect(october.actual).toMatchObject({ status: "fetched", fetchedAt: "2026-11-01T09:00:00.000Z" });
    expect(compareCashPlan(october.plan.values as never, october.actual).map((r) => r.difference)).toEqual([
      -100, // 当座・普通 3,000 − 予定 3,100
      0, // 定期 300 − 予定 300
      -100, // 担保控除前の合計(現金は含めない)
    ]);
    if (october.actual.status === "fetched") expect(actualKindsDifference(october.actual)).toBe(0);
    expect(view.cashPlans.find((c) => c.plan.targetMonth === "2026-11")!.actual.status).toBe("beforeMonthEnd");

    // 経理の登録値は書き換えない
    expect(savePlanMock).not.toHaveBeenCalled();
    expect(october.plan).toEqual(plan("2026-10"));
  });

  it("分類できない預金科目があれば、取得後も種類別の合計と月末現預金の差が出る(警告対象)", async () => {
    trialBsByMonth.set(10, [cashLeaf("普通預金_銀行B", 3_000), cashLeaf("外貨預金_銀行D", 70)]);
    await runScheduledRefreshAt("2026-11-01T09:00:00Z", 11);

    const view = await getAccountingReportsView(new Date("2026-11-01T10:00:00Z"));
    const october = view.cashPlans.find((c) => c.plan.targetMonth === "2026-10")!;
    expect(october.actual.status).toBe("fetched");
    if (october.actual.status === "fetched") expect(actualKindsDifference(october.actual)).toBe(70);
  });

  it("月末後でも、その月の更新が一度も成功していなければ未取得のまま", async () => {
    expect(await statuses("2026-11-05T01:00:00Z")).toEqual({ "2026-11": "beforeMonthEnd", "2026-10": "notFetched" });
  });
});
