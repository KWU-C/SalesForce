import { describe, expect, it } from "vitest";
import {
  actualTargets,
  buildActualRow,
  buildForecastState,
  forecastTimeDeposit,
  reserveDeductions,
} from "./fundSummary";
import { targetMonth } from "./overviewComparison";
import { validateReferenceForecastRecord, type ReferenceForecastRecord, type ReferencePaymentReserveItem } from "./referenceForecast";

function month(m: string, start: number, end: number, timeDeposit = 0) {
  const byCategory: Record<string, number> = { "入金:売掛": end - start + timeDeposit };
  if (timeDeposit) byCategory["振替:定期積立"] = -timeDeposit;
  return {
    month: m,
    start,
    end,
    minEndOfDay: { date: `${m}-18`, amount: end - 50 },
    minIntraday: end - 60,
    byBasis: { 登録済み: end - start },
    byCategory,
  };
}

function item(id: string, targetMonth: string, amount: number, reflected: string | null): ReferencePaymentReserveItem {
  return { id, label: id, targetMonth, amount, kind: "推計", reflectedInForecastFrom: reflected, basis: "test" };
}

function record(): ReferenceForecastRecord {
  const cases = [
    { id: "standard", months: [month("2026-11", 1000, 2000, 10), month("2026-12", 2000, 1500, 10)] },
    { id: "cautious", months: [month("2026-11", 1000, 1800, 10), month("2026-12", 1800, 900, 10)] },
    { id: "yearEndSlip", months: [month("2026-11", 1000, 2000, 10), month("2026-12", 2000, 800, 10)] },
  ].map((c) => ({ ...c, label: c.id }));
  return {
    schemaVersion: 1,
    id: "2026-11-16_20261117T150000",
    baseDate: "2026-11-16",
    createdAt: "2026-11-17T15:00:00+09:00",
    cashComputedAt: "2026-11-17T09:14:06+09:00",
    derivedFrom: "2026-11-16_20261117T091406",
    createdBy: "test",
    codeCommit: "abc",
    dataFetchedAt: { freee: "x", salesforce: "y" },
    cash: {
      startBalance: 1000,
      startTimeDeposit: 500,
      startCash: 3,
      cases,
      dec31Receipts: { sfAdded: 0, sfAddedStandardKinds: 0, freeeUnsettled: 0 },
      checks: { ownTransfers: {}, excludedFromBulk: [], bulkReference: [], payrollDecember: null },
    },
    matching: { byClass: [], ambiguous: [], freeeUnmatchedUnsettled: { count: 0, amount: 0 } },
    pl: { scenarios: [{ id: "A", label: "A", months: [], cumulative: { revenue: 0, ordinaryProfit: 0 } }] },
    notes: { basis: [], estimates: [], limits: [] },
    paymentReserve: {
      fetchedAt: "2026-11-17T15:00:00+09:00",
      accounting: { asOf: "2026-10-31", bonusProvision: 30, consumptionTaxPayable: 0, consumptionTaxReceived: 70, consumptionTaxPaid: 20 },
      items: [item("tax", "2027-01", 80, null), item("bonusNet", "2026-12", 130, "2026-12"), item("bonusDed", "2027-01", 40, null)],
      history: { consumptionTax: [], bonus: [] },
      limits: [],
    },
  };
}

describe("資金サマリー(実績)", () => {
  it("締まった直近2か月を古い順に返す(期をまたぐ場合も)", () => {
    expect(actualTargets(targetMonth(50, 10)).map((t) => t.key)).toEqual(["2026-09", "2026-10"]);
    expect(actualTargets(targetMonth(50, 9)).map((t) => t.key)).toEqual(["2026-08", "2026-09"]);
  });

  it("預金総合計は当座・普通＋定期で、現金を含めない", () => {
    const row = buildActualRow(
      targetMonth(50, 10),
      { cashClosing: 1305, checkingSavingsClosing: 1000, timeDepositClosing: 300, cashOnHandClosing: 5, fetchedAt: new Date("2026-11-01T09:00:00Z") },
      new Date("2026-11-17T00:00:00Z")
    );
    expect(row).toMatchObject({ status: "fetched", checkingSavings: 1000, depositTotal: 1300 });
  });

  it("月末前に取得したスナップショットは実績にしない", () => {
    const row = buildActualRow(
      targetMonth(50, 10),
      { cashClosing: 1, checkingSavingsClosing: 1, timeDepositClosing: 0, cashOnHandClosing: 0, fetchedAt: new Date("2026-10-30T00:00:00Z") },
      new Date("2026-11-17T00:00:00Z")
    );
    expect(row.status).toBe("notFetched");
  });
});

describe("資金サマリー(予測)", () => {
  it("予測の定期預金は起点＋予測期間中の定期積立", () => {
    expect(forecastTimeDeposit(record(), "standard", "2026-11")).toBe(510);
    expect(forecastTimeDeposit(record(), "standard", "2026-12")).toBe(520);
  });

  it("当月末の標準ケースを主表示、慎重ケースと月中最低を補足、計算日時は資金予測の計算日時", () => {
    const state = buildForecastState(record(), targetMonth(50, 11));
    expect(state.status).toBe("available");
    if (state.status !== "available") return;
    expect(state.computedAt).toBe("2026-11-17T09:14:06+09:00");
    expect(state.row).toMatchObject({
      checkingSavings: 2000,
      depositTotal: 2510,
      cautious: { checkingSavings: 1800, depositTotal: 2310 },
      standardMin: { date: "2026-11-18", amount: 1950 },
      cautiousMin: { date: "2026-11-18", amount: 1750 },
    });
  });

  it("記録が無い・当月の予測が無いときは表示しない", () => {
    expect(buildForecastState(null, targetMonth(50, 11)).status).toBe("unavailable");
    expect(buildForecastState(record(), targetMonth(51, 1)).status).toBe("unavailable");
  });
});

describe("支払準備の控除後残高", () => {
  it("予測に未反映の支払見込額だけを差し引き、予測に含まれる支払は二重に引かない", () => {
    const [nov, dec] = reserveDeductions(record());
    // 11月末: 12月の賞与振込はまだ予測残高に含まれないので差し引く
    expect(nov.deducted.map((i) => i.id)).toEqual(["tax", "bonusNet", "bonusDed"]);
    expect(nov.balanceAfter).toBe(2000 - 250);
    // 12月末: 賞与振込は12月の予測に出金として含まれるので差し引かない
    expect(dec.included.map((i) => i.id)).toEqual(["bonusNet"]);
    expect(dec.deducted.map((i) => i.id)).toEqual(["tax", "bonusDed"]);
    expect(dec.balanceAfter).toBe(1500 - 120);
  });

  it("支払準備の無い記録では控除後残高を出さない", () => {
    expect(reserveDeductions({ ...record(), paymentReserve: undefined })).toEqual([]);
  });

  it("記録の検査: 支払準備の金額・対象月の形を確かめる", () => {
    expect(validateReferenceForecastRecord(record())).toEqual([]);
    const bad = record();
    bad.paymentReserve!.items[0] = { ...bad.paymentReserve!.items[0], amount: -1, targetMonth: "2027/01" };
    expect(validateReferenceForecastRecord(bad)).toHaveLength(2);
  });
});
