import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const touched = vi.fn();
vi.mock("@/services/firestore/firestoreClient", () => ({
  getFirestoreClient: () => {
    touched("firestore");
    throw new Error("Firestore must not be reached");
  },
}));
vi.mock("@/repositories/freeeAuthRepository", () => ({
  getValidFreeeAccessToken: async () => {
    touched("freee");
    throw new Error("freee must not be reached");
  },
  getFreeeCompanyId: async () => {
    touched("freee");
    throw new Error("freee must not be reached");
  },
}));

const { runCashForecastJob, staleMonths } = await import("./cashForecastJob");

const ORIGINAL = { ...process.env };
function asJob(name: string, databaseId?: string) {
  for (const k of ["K_SERVICE", "CLOUD_RUN_JOB", "CLOUD_RUN_EXECUTION", "ALLOW_PRODUCTION_DATA_WRITES", "FIRESTORE_DATABASE_ID"]) delete process.env[k];
  process.env.CLOUD_RUN_JOB = name;
  process.env.CLOUD_RUN_EXECUTION = `${name}-abcde`;
  if (databaseId) process.env.FIRESTORE_DATABASE_ID = databaseId;
}
beforeEach(() => touched.mockReset());
afterEach(() => {
  process.env = { ...ORIGINAL };
});

const NOW = new Date("2026-10-21T09:30:00Z"); // 日本時間 18:30
const okRefresh = async () => ({ date: "2026-10-21", executionName: "x", status: "succeeded" as const, detail: null, startedAt: "2026-10-21T09:00:10.000Z", finishedAt: "2026-10-21T09:02:40.000Z" });
const fresh = { "2026-09": "2026-10-21T09:02:30.000Z", "2026-10": "2026-10-21T09:01:00.000Z" };
const okResult = { status: "ok" as const, baseDate: "2026-10-21", settings: {} as never, growth: {} as never, months: [{}] as never, warnings: [] };

function deps(overrides: Record<string, unknown> = {}) {
  const saveForecast = vi.fn(async () => {});
  const saveRun = vi.fn(async () => {});
  const collect = vi.fn(async () => ({ inputs: { failures: [] } as never, currentMonthSnapshotFetchedAt: "2026-10-21T09:02:00.000Z", snapshotFetchedAt: fresh as Record<string, string> }));
  const build = vi.fn(() => okResult as never);
  return { now: () => NOW, getRefreshRun: okRefresh, collect, build, saveForecast, saveRun, log: vi.fn(), error: vi.fn(), ...overrides };
}

describe("資金繰り予測Job", () => {
  it("stops before touching anything when the environment/database pair is not allowed", async () => {
    asJob("tcd-dashboard-dev2-cash-forecast"); // dev2のJobが本番DB(既定)を向いている
    const d = deps();
    expect(await runCashForecastJob(d)).toBe(1);
    expect(d.collect).not.toHaveBeenCalled();
    expect(d.saveRun).not.toHaveBeenCalled();
    expect(touched).not.toHaveBeenCalled();
  });

  it("saves the forecast and a succeeded run on the production job", async () => {
    asJob("tcd-dashboard-prod-cash-forecast");
    const d = deps();
    expect(await runCashForecastJob(d)).toBe(0);
    expect(d.collect).toHaveBeenCalledWith("2026-10-21", expect.anything());
    expect(d.saveForecast).toHaveBeenCalledWith(expect.objectContaining({ baseDate: "2026-10-21", executionName: "tcd-dashboard-prod-cash-forecast-abcde", currentMonthSnapshotFetchedAt: "2026-10-21T09:02:00.000Z" }));
    expect(d.saveRun).toHaveBeenCalledWith(expect.objectContaining({ status: "succeeded", baseDate: "2026-10-21" }));
  });

  it.each([
    ["no refresh record today", async () => null, "当日の定時更新の記録がありません"],
    ["refresh failed today", async () => ({ date: "2026-10-21", executionName: "x", status: "failed" as const, detail: "freee_api_error", startedAt: "", finishedAt: "" }), "当日の定時更新が成功していません(freee_api_error)"],
  ])("skips without overwriting the last forecast: %s", async (_label, getRefreshRun, reason) => {
    asJob("tcd-dashboard-prod-cash-forecast");
    const d = deps({ getRefreshRun });
    expect(await runCashForecastJob(d)).toBe(0);
    expect(d.collect).not.toHaveBeenCalled();
    expect(d.saveForecast).not.toHaveBeenCalled();
    expect(d.saveRun).toHaveBeenCalledWith(expect.objectContaining({ status: "skipped", skipReason: reason }));
  });

  it.each([
    ["the previous month was fetched before today's refresh", { "2026-09": "2026-10-20T09:02:30.000Z", "2026-10": "2026-10-21T09:01:00.000Z" }, "2026-09"],
    ["the current month snapshot is missing", { "2026-09": "2026-10-21T09:02:30.000Z" }, "2026-10"],
  ])("skips when the actuals are stale: %s", async (_label, snapshotFetchedAt, month) => {
    asJob("tcd-dashboard-prod-cash-forecast");
    const collect = vi.fn(async () => ({ inputs: { failures: [] } as never, currentMonthSnapshotFetchedAt: null, snapshotFetchedAt }));
    const d = deps({ collect });
    expect(await runCashForecastJob(d)).toBe(0);
    expect(d.build).not.toHaveBeenCalled();
    expect(d.saveForecast).not.toHaveBeenCalled();
    expect(d.saveRun).toHaveBeenCalledWith(expect.objectContaining({ status: "skipped", skipReason: expect.stringContaining(month) }));
  });

  it("checks freshness against the previous year's December in January", () => {
    expect(staleMonths("2027-01-05", { "2026-12": "2027-01-05T09:00:00Z", "2027-01": "2027-01-05T09:00:00Z" }, "2027-01-05T08:59:00Z")).toEqual([]);
    expect(staleMonths("2027-01-05", { "2027-01": "2027-01-05T09:00:00Z" }, "2027-01-05T08:59:00Z")).toEqual(["2026-12"]);
  });

  it("records a failed run (with the failed sources) and never saves a forecast when inputs failed", async () => {
    asJob("tcd-dashboard-prod-cash-forecast");
    const failures = [{ source: "deals", kind: "forbidden" }];
    const d = deps({ build: vi.fn(() => ({ status: "failed", baseDate: "2026-10-21", failures })) });
    expect(await runCashForecastJob(d)).toBe(1);
    expect(d.saveForecast).not.toHaveBeenCalled();
    expect(d.saveRun).toHaveBeenCalledWith(expect.objectContaining({ status: "failed", failures }));
  });

  it("records a failed run when something throws midway", async () => {
    asJob("tcd-dashboard-prod-cash-forecast");
    const d = deps({ collect: vi.fn(async () => { throw new TypeError("boom"); }) });
    expect(await runCashForecastJob(d)).toBe(1);
    expect(d.saveForecast).not.toHaveBeenCalled();
    expect(d.saveRun).toHaveBeenCalledWith(expect.objectContaining({ status: "failed", failures: [{ source: "job", kind: "TypeError" }] }));
  });

  it("runs on the dev2 job against dashboard-dev", async () => {
    asJob("tcd-dashboard-dev2-cash-forecast", "dashboard-dev");
    const d = deps();
    expect(await runCashForecastJob(d)).toBe(0);
    expect(d.saveForecast).toHaveBeenCalled();
  });
});
