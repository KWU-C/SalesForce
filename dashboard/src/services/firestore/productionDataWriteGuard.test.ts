import { describe, expect, it } from "vitest";
import {
  ProductionDataWriteBlockedError,
  assertProductionDataWritable,
  canWriteFreeeTokenDocument,
  canWriteProductionData,
  describeRuntimeEnvironment,
} from "./productionDataWriteGuard";

const env = (service?: string, job?: string, localOverride?: string) => ({ service, job, localOverride });

describe("canWriteProductionData", () => {
  it("allows only the production service and the production job", () => {
    expect(canWriteProductionData(env("tcd-dashboard-prod"))).toBe(true);
    expect(canWriteProductionData(env(undefined, "tcd-dashboard-prod-finance-refresh"))).toBe(true);
  });

  it("blocks dev2, the retired dev, the dev2 job and unknown services", () => {
    expect(canWriteProductionData(env("tcd-dashboard-dev2"))).toBe(false);
    expect(canWriteProductionData(env("tcd-dashboard-dev"))).toBe(false);
    expect(canWriteProductionData(env(undefined, "tcd-dashboard-dev2-finance-refresh"))).toBe(false);
    expect(canWriteProductionData(env("something-else"))).toBe(false);
  });

  it("does not let the local override unlock a non-production Cloud Run environment", () => {
    expect(canWriteProductionData(env("tcd-dashboard-dev2", undefined, "true"))).toBe(false);
    expect(canWriteProductionData(env(undefined, "tcd-dashboard-dev2-finance-refresh", "true"))).toBe(false);
  });

  it("blocks local runs unless explicitly allowed", () => {
    expect(canWriteProductionData(env())).toBe(false);
    expect(canWriteProductionData(env(undefined, undefined, "1"))).toBe(false);
    expect(canWriteProductionData(env(undefined, undefined, "true"))).toBe(true);
  });
});

describe("assertProductionDataWritable", () => {
  it("throws a dedicated error naming only the collection", () => {
    expect(() => assertProductionDataWritable("monthlyCashFlowSnapshots", env("tcd-dashboard-dev2"))).toThrow(
      ProductionDataWriteBlockedError
    );
    expect(() => assertProductionDataWritable("monthlyCashFlowSnapshots", env("tcd-dashboard-prod"))).not.toThrow();
  });
});

describe("describeRuntimeEnvironment", () => {
  it("names the environment (job/service/local) and the database together with the decision", () => {
    expect(describeRuntimeEnvironment(env(undefined, "tcd-dashboard-prod-finance-refresh"))).toEqual({ kind: "job", name: "tcd-dashboard-prod-finance-refresh", databaseId: "dashboard", writable: true });
    expect(describeRuntimeEnvironment(env(undefined, "tcd-dashboard-dev2-finance-refresh"))).toEqual({ kind: "job", name: "tcd-dashboard-dev2-finance-refresh", databaseId: "dashboard", writable: false });
    expect(describeRuntimeEnvironment(env("tcd-dashboard-prod"))).toEqual({ kind: "service", name: "tcd-dashboard-prod", databaseId: "dashboard", writable: true });
    expect(describeRuntimeEnvironment(env())).toEqual({ kind: "local", name: null, databaseId: "dashboard", writable: false });
    expect(describeRuntimeEnvironment({ ...env(undefined, "tcd-dashboard-dev2-finance-refresh"), databaseId: "dashboard-dev" })).toEqual({ kind: "job", name: "tcd-dashboard-dev2-finance-refresh", databaseId: "dashboard-dev", writable: true });
  });
});

describe("接続先データベースによる判定(環境分離)", () => {
  const onDb = (databaseId: string, service?: string, job?: string) => ({ ...env(service, job), databaseId });

  it("allows only the approved environment → database pairs", () => {
    expect(canWriteProductionData(onDb("dashboard", "tcd-dashboard-prod"))).toBe(true);
    expect(canWriteProductionData(onDb("dashboard", undefined, "tcd-dashboard-prod-finance-refresh"))).toBe(true);
    expect(canWriteProductionData(onDb("dashboard-dev", "tcd-dashboard-dev2"))).toBe(true);
    expect(canWriteProductionData(onDb("dashboard-dev", undefined, "tcd-dashboard-dev2-finance-refresh"))).toBe(true);
  });

  it("denies production → dashboard-dev and every other combination", () => {
    expect(canWriteProductionData(onDb("dashboard-dev", "tcd-dashboard-prod"))).toBe(false);
    expect(canWriteProductionData(onDb("dashboard-dev", undefined, "tcd-dashboard-prod-finance-refresh"))).toBe(false);
    expect(canWriteProductionData(onDb("dashboard-dev", "tcd-dashboard-dev"))).toBe(false);
    expect(canWriteProductionData(onDb("dashboard-dev", "something-else"))).toBe(false);
    expect(canWriteProductionData(onDb("other-db", "tcd-dashboard-dev2"))).toBe(false);
    expect(canWriteProductionData(onDb("other-db", "tcd-dashboard-prod"))).toBe(false);
    // ローカルは明示許可が無ければどのデータベースも拒否、明示すれば従来どおり許可
    expect(canWriteProductionData(onDb("dashboard-dev"))).toBe(false);
    expect(canWriteProductionData({ ...env(undefined, undefined, "true"), databaseId: "dashboard-dev" })).toBe(true);
  });

  it("keeps the production-only rule when the database is production (e.g. a dev2 misconfiguration)", () => {
    expect(canWriteProductionData(onDb("dashboard", "tcd-dashboard-dev2"))).toBe(false);
    expect(canWriteProductionData(onDb("dashboard", undefined, "tcd-dashboard-dev2-finance-refresh"))).toBe(false);
    expect(canWriteProductionData(onDb("dashboard", "tcd-dashboard-prod"))).toBe(true);
    // 未指定は本番のデータベースとして扱う
    expect(canWriteProductionData(env("tcd-dashboard-dev2"))).toBe(false);
  });
});

describe("資金繰り予測Job", () => {
  const job = (name: string, databaseId = "dashboard") => ({ service: undefined, job: name, localOverride: undefined, databaseId });
  it("allows the forecast jobs only against their own database", () => {
    expect(canWriteProductionData(job("tcd-dashboard-prod-cash-forecast"))).toBe(true);
    expect(canWriteProductionData(job("tcd-dashboard-prod-cash-forecast", "dashboard-dev"))).toBe(false);
    expect(canWriteProductionData(job("tcd-dashboard-dev2-cash-forecast", "dashboard-dev"))).toBe(true);
    expect(canWriteProductionData(job("tcd-dashboard-dev2-cash-forecast"))).toBe(false);
  });

  it("maps a forecast job to its service's freee token only", () => {
    expect(canWriteFreeeTokenDocument("tcd-dashboard-prod", job("tcd-dashboard-prod-cash-forecast"))).toBe(true);
    expect(canWriteFreeeTokenDocument("tcd-dashboard-dev2", job("tcd-dashboard-prod-cash-forecast"))).toBe(false);
    expect(canWriteFreeeTokenDocument("tcd-dashboard-dev2", job("tcd-dashboard-dev2-cash-forecast", "dashboard-dev"))).toBe(true);
  });
});
