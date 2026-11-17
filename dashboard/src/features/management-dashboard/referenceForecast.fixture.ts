// 参考予測の記録の試験用データ(金額はすべて架空の値)
import type { ReferenceForecastRecord, ReferencePaymentReserveItem } from "./referenceForecast";

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

export function fixtureRecord(): ReferenceForecastRecord {
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

