import { describe, expect, it } from "vitest";
import { isManagementDashboardAuthorized } from "./managementDashboardAccess";

describe("isManagementDashboardAuthorized", () => {
  it("allows an email on the allowlist", () => {
    expect(isManagementDashboardAuthorized("kawauchi@tcd.jp")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isManagementDashboardAuthorized("Kawauchi@TCD.jp")).toBe(true);
  });

  it("rejects an email not on the allowlist", () => {
    expect(isManagementDashboardAuthorized("someone-else@tcd.jp")).toBe(false);
  });

  it("rejects null", () => {
    expect(isManagementDashboardAuthorized(null)).toBe(false);
  });
});
