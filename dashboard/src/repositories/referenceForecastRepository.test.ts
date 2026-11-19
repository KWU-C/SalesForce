import { describe, expect, it, vi, afterEach } from "vitest";
import { addReferenceForecast, getLatestReferenceForecast, type ReferenceForecastStore } from "./referenceForecastRepository";
import {
  formatManYenDelta,
  formatManYenInt,
  isReferenceForecastEnabled,
  validateReferenceForecastRecord,
  type ReferenceForecastRecord,
} from "@/features/management-dashboard/referenceForecast";

function month(m: string, start: number, end: number) {
  return {
    month: m,
    start,
    end,
    minEndOfDay: { date: `${m}-18`, amount: end - 1 },
    minIntraday: end - 2,
    byBasis: { 登録済み: end - start },
    byCategory: { "入金:売掛": end - start },
  };
}

function record(overrides: Partial<ReferenceForecastRecord> = {}): ReferenceForecastRecord {
  const cases = ["standard", "cautious", "yearEndSlip"].map((id) => ({
    id,
    label: id,
    months: [month("2026-11", 100, 200), month("2026-12", 200, 150)],
  }));
  return {
    schemaVersion: 1,
    id: "2026-11-16_20261117T120000",
    baseDate: "2026-11-16",
    createdAt: "2026-11-17T12:00:00+09:00",
    createdBy: "test",
    codeCommit: "abc",
    dataFetchedAt: { freee: "x", salesforce: "y" },
    cash: {
      startBalance: 100,
      startTimeDeposit: 0,
      startCash: 0,
      cases,
      dec31Receipts: { sfAdded: 0, sfAddedStandardKinds: 0, freeeUnsettled: 0 },
      checks: { ownTransfers: {}, excludedFromBulk: [], bulkReference: [], payrollDecember: null },
    },
    matching: { byClass: [], ambiguous: [], freeeUnmatchedUnsettled: { count: 0, amount: 0 } },
    pl: { scenarios: [{ id: "A", label: "a", months: [], cumulative: { revenue: 0, ordinaryProfit: 0 } }] },
    notes: { basis: [], estimates: [], limits: [] },
    ...overrides,
  };
}

function memoryStore() {
  const docs = new Map<string, ReferenceForecastRecord>();
  const store: ReferenceForecastStore = {
    create: vi.fn(async (id, doc) => {
      if (docs.has(id)) throw new Error("ALREADY_EXISTS");
      docs.set(id, doc);
    }),
    getLatest: vi.fn(async () => [...docs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null),
  };
  return { docs, store };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("参考予測の保存(本番・devのデータベース、上書きしない)", () => {
  it("dashboard-dev には1件ずつ追加し、同じIDは上書きしない", async () => {
    vi.stubEnv("ALLOW_PRODUCTION_DATA_WRITES", "true");
    const { docs, store } = memoryStore();
    await addReferenceForecast(record(), store, "dashboard-dev");
    await addReferenceForecast(record({ id: "2026-11-16_20261117T130000", createdAt: "2026-11-17T13:00:00+09:00" }), store, "dashboard-dev");
    expect(docs.size).toBe(2);
    await expect(addReferenceForecast(record(), store, "dashboard-dev")).rejects.toThrow("ALREADY_EXISTS");
    expect(docs.get("2026-11-16_20261117T120000")?.createdAt).toBe("2026-11-17T12:00:00+09:00");
  });

  it("本番のサービスは本番のデータベース(dashboard)に保存できる(2026-11-19)", async () => {
    vi.stubEnv("K_SERVICE", "tcd-dashboard-prod");
    vi.stubEnv("FIRESTORE_DATABASE_ID", "dashboard");
    const { docs, store } = memoryStore();
    await addReferenceForecast(record(), store, "dashboard");
    expect(docs.size).toBe(1);
  });

  it("dev2のサービスは本番のデータベースに書けず、本番のサービスはdevのデータベースに書けない(書き込みガード)", async () => {
    const { store } = memoryStore();
    vi.stubEnv("K_SERVICE", "tcd-dashboard-dev2");
    vi.stubEnv("FIRESTORE_DATABASE_ID", "dashboard");
    await expect(addReferenceForecast(record(), store, "dashboard")).rejects.toThrow();
    vi.stubEnv("K_SERVICE", "tcd-dashboard-prod");
    vi.stubEnv("FIRESTORE_DATABASE_ID", "dashboard-dev");
    await expect(addReferenceForecast(record(), store, "dashboard-dev")).rejects.toThrow();
    expect(store.create).not.toHaveBeenCalled();
  });

  it("本番・dev以外のデータベースには書かない", async () => {
    vi.stubEnv("ALLOW_PRODUCTION_DATA_WRITES", "true");
    const { store } = memoryStore();
    await expect(addReferenceForecast(record(), store, "other-db")).rejects.toThrow("にだけ保存します");
    expect(store.create).not.toHaveBeenCalled();
  });

  it("損益の参考試算が空(未計算)の記録も保存できる(本番の最初の記録)", async () => {
    vi.stubEnv("ALLOW_PRODUCTION_DATA_WRITES", "true");
    const { docs, store } = memoryStore();
    await addReferenceForecast(record({ pl: { scenarios: [] } }), store, "dashboard-dev");
    expect(docs.size).toBe(1);
  });

  it("ローカルで書き込みの明示許可が無ければ書かない", async () => {
    const { store } = memoryStore();
    await expect(addReferenceForecast(record(), store, "dashboard-dev")).rejects.toThrow();
    expect(store.create).not.toHaveBeenCalled();
  });

  it("根拠別の合計が残高の増減と合わない記録は保存しない", async () => {
    vi.stubEnv("ALLOW_PRODUCTION_DATA_WRITES", "true");
    const { store } = memoryStore();
    const bad = record();
    bad.cash.cases[0].months[0].byBasis = { 登録済み: 1 };
    await expect(addReferenceForecast(bad, store, "dashboard-dev")).rejects.toThrow("一致しません");
    expect(store.create).not.toHaveBeenCalled();
  });

  it("本番・devのデータベースでは自分の記録を読み、それ以外では読まずにnullを返す", async () => {
    const { store } = memoryStore();
    expect(await getLatestReferenceForecast(store, "other-db")).toBeNull();
    expect(store.getLatest).not.toHaveBeenCalled();
    await getLatestReferenceForecast(store, "dashboard");
    expect(store.getLatest).toHaveBeenCalledTimes(1);
    expect(isReferenceForecastEnabled("dashboard")).toBe(true);
    expect(isReferenceForecastEnabled("dashboard-dev")).toBe(true);
    expect(isReferenceForecastEnabled("other-db")).toBe(false);
  });
});

describe("記録の検査と表示の書式", () => {
  it("正しい記録は通し、取引先名らしき項目・ケースの不足を止める", () => {
    expect(validateReferenceForecastRecord(record())).toEqual([]);
    const withName = { ...record(), extra: { 取引先名: "x" } };
    expect(validateReferenceForecastRecord(withName).join()).toContain("取引先名");
    const r = record();
    r.cash.cases = r.cash.cases.filter((c) => c.id !== "yearEndSlip");
    expect(validateReferenceForecastRecord(r).join()).toContain("yearEndSlip");
  });

  it("万円単位で表示する", () => {
    expect(formatManYenInt(79_732_599)).toBe("7,973万円");
    expect(formatManYenInt(-12_340_000)).toBe("▲1,234万円");
    expect(formatManYenDelta(23_264_916)).toBe("＋2,326万円");
    expect(formatManYenDelta(-8_750_639)).toBe("▲875万円");
    expect(formatManYenDelta(4_000)).toBe("±0万円");
  });
});
