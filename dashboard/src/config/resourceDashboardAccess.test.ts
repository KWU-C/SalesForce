import { describe, expect, it } from "vitest";
import { isManagementDashboardAuthorized } from "./managementDashboardAccess";
import { isResourceDashboardAuthorized } from "./resourceDashboardAccess";

describe("isResourceDashboardAuthorized", () => {
  it("allows everyone on the management allowlist", () => {
    expect(isResourceDashboardAuthorized("kawauchi@tcd.jp")).toBe(true);
  });

  it("allows resource-only members without granting management access", () => {
    for (const email of [
      "yamamoto.miki@tcd.jp",
      "kamao@tcd.jp",
      "nonaka@tcd.jp",
      "osugi@tcd.jp",
      "ushio@tcd.jp",
      "ito@tcd.jp",
    ]) {
      expect(isResourceDashboardAuthorized(email)).toBe(true);
      expect(isManagementDashboardAuthorized(email)).toBe(false);
    }
  });

  it("is case-insensitive", () => {
    expect(isResourceDashboardAuthorized("Kamao@TCD.jp")).toBe(true);
  });

  it("rejects an email not on the allowlist", () => {
    expect(isResourceDashboardAuthorized("someone-else@tcd.jp")).toBe(false);
  });

  it("rejects null", () => {
    expect(isResourceDashboardAuthorized(null)).toBe(false);
  });
});
