import { describe, expect, it } from "vitest";
import { isDevDeployment } from "./deployEnvironment";

describe("isDevDeployment", () => {
  it("is true on the dev Cloud Run service", () => {
    expect(isDevDeployment("tcd-dashboard-dev")).toBe(true);
  });

  it("is false on the prod Cloud Run service", () => {
    expect(isDevDeployment("tcd-dashboard-prod")).toBe(false);
  });

  it("is false outside Cloud Run (K_SERVICE unset)", () => {
    expect(isDevDeployment(undefined)).toBe(false);
  });
});
