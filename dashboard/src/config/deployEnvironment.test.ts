import { describe, expect, it } from "vitest";
import { isDevDeployment, isPreReleaseEnabled, isPreReleasePath, isRetiredDeployment } from "./deployEnvironment";

describe("isDevDeployment", () => {
  it("is true on the dev Cloud Run service", () => {
    expect(isDevDeployment("tcd-dashboard-dev2")).toBe(true);
  });

  it("is false on the prod Cloud Run service", () => {
    expect(isDevDeployment("tcd-dashboard-prod")).toBe(false);
  });

  it("is false on the retired dev Cloud Run service", () => {
    expect(isDevDeployment("tcd-dashboard-dev")).toBe(false);
  });

  it("is false outside Cloud Run (K_SERVICE unset)", () => {
    expect(isDevDeployment(undefined)).toBe(false);
  });
});

describe("isRetiredDeployment", () => {
  it("is true only on the retired dev Cloud Run service", () => {
    expect(isRetiredDeployment("tcd-dashboard-dev")).toBe(true);
  });

  it("is false on the current dev and prod Cloud Run services", () => {
    expect(isRetiredDeployment("tcd-dashboard-dev2")).toBe(false);
    expect(isRetiredDeployment("tcd-dashboard-prod")).toBe(false);
  });

  it("is false outside Cloud Run (K_SERVICE unset)", () => {
    expect(isRetiredDeployment(undefined)).toBe(false);
  });
});

describe("isPreReleaseEnabled", () => {
  it("is enabled only on dev and locally, not on prod or the retired dev service", () => {
    expect(isPreReleaseEnabled("tcd-dashboard-dev2")).toBe(true);
    expect(isPreReleaseEnabled(undefined)).toBe(true);
    expect(isPreReleaseEnabled("tcd-dashboard-prod")).toBe(false);
    expect(isPreReleaseEnabled("tcd-dashboard-dev")).toBe(false);
  });
});

describe("isPreReleasePath", () => {
  it("matches the unreleased pages and their API, including sub-paths", () => {
    expect(isPreReleasePath("/client-targets")).toBe(true);
    expect(isPreReleasePath("/client-targets/sub")).toBe(true);
  });

  it("does not match released pages or look-alike paths", () => {
    expect(isPreReleasePath("/")).toBe(false);
    expect(isPreReleasePath("/management")).toBe(false);
    expect(isPreReleasePath("/api/accounting-reports/cash-plan/2026-10")).toBe(false);
    expect(isPreReleasePath("/client-targets-old")).toBe(false);
    expect(isPreReleasePath("/focus-clients")).toBe(false);
    expect(isPreReleasePath("/api/focus-clients/0015i00000AbCdEAAZ")).toBe(false);
  });
});
