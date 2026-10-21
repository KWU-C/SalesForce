import { afterEach, describe, expect, it, vi } from "vitest";
import { ProductionDataWriteBlockedError } from "@/services/firestore/productionDataWriteGuard";

const writes = vi.fn();
vi.mock("@/services/firestore/firestoreClient", () => ({
  getFirestoreClient: () => ({
    collection: (name: string) => ({
      doc: (id: string) => ({
        set: async (data: unknown) => writes(name, id, data),
        get: async () => ({ exists: false }),
      }),
    }),
  }),
}));

const { cashForecastRunId, saveCashForecastRun, saveSucceededCashForecast } = await import("./cashForecastRepository");
const { saveFinanceRefreshRun } = await import("./financeRefreshRunRepository");

const ORIGINAL = { ...process.env };
afterEach(() => {
  process.env = { ...ORIGINAL };
  writes.mockReset();
});

const okDoc = {
  baseDate: "2026-10-21",
  generatedAt: "2026-10-21T09:30:00.000Z",
  executionName: "exec-1",
  currentMonthSnapshotFetchedAt: null,
  result: { status: "ok", baseDate: "2026-10-21", settings: {}, growth: { raw: null }, months: [{ referenceRange: null, extra: undefined }], warnings: [] },
} as never;

describe("cashForecastRepository", () => {
  it("writes the forecast under its base date, dropping undefined fields (Firestore cannot store them)", async () => {
    process.env.K_SERVICE = "tcd-dashboard-prod";
    delete process.env.FIRESTORE_DATABASE_ID;
    await saveSucceededCashForecast(okDoc);
    expect(writes).toHaveBeenCalledTimes(1);
    const [collection, id, data] = writes.mock.calls[0];
    expect([collection, id]).toEqual(["cashForecasts", "2026-10-21"]);
    expect(JSON.stringify(data)).not.toContain("extra");
    expect((data as { result: { months: { referenceRange: null }[] } }).result.months[0].referenceRange).toBeNull();
  });

  it("refuses to store a failed forecast in cashForecasts", async () => {
    process.env.K_SERVICE = "tcd-dashboard-prod";
    await expect(saveSucceededCashForecast({ ...(okDoc as object), result: { status: "failed" } } as never)).rejects.toThrow();
    expect(writes).not.toHaveBeenCalled();
  });

  it("keys run records by base date and execution", async () => {
    process.env.K_SERVICE = "tcd-dashboard-prod";
    await saveCashForecastRun({ baseDate: "2026-10-21", executionName: "exec-1", status: "skipped", failures: [], skipReason: "r", startedAt: "", finishedAt: "" });
    expect(writes.mock.calls[0].slice(0, 2)).toEqual(["cashForecastRuns", cashForecastRunId("2026-10-21", "exec-1")]);
  });

  it.each([
    ["cashForecasts", () => saveSucceededCashForecast(okDoc)],
    ["cashForecastRuns", () => saveCashForecastRun({ baseDate: "2026-10-21", executionName: "e", status: "failed", failures: [], skipReason: null, startedAt: "", finishedAt: "" })],
    ["financeRefreshRuns", () => saveFinanceRefreshRun({ date: "2026-10-21", executionName: "e", status: "succeeded", detail: null, startedAt: "", finishedAt: "" })],
  ])("%s: dev2 pointed at the production database is blocked", async (_name, write) => {
    process.env.K_SERVICE = "tcd-dashboard-dev2";
    delete process.env.FIRESTORE_DATABASE_ID;
    await expect(write()).rejects.toBeInstanceOf(ProductionDataWriteBlockedError);
    expect(writes).not.toHaveBeenCalled();
  });
});
