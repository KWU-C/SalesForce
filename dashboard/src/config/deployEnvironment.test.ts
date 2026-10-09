import { describe, expect, it } from "vitest";
import { isDevDeployment, isRetiredDeployment } from "./deployEnvironment";

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
