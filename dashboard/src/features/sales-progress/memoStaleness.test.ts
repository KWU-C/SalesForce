import { describe, expect, it } from "vitest";
import { isMemoStale } from "./memoStaleness";

describe("isMemoStale", () => {
  const now = new Date("2026-09-16T00:00:00.000Z");

  it("is not stale when updated less than 2 months ago", () => {
    expect(isMemoStale("2026-08-01T00:00:00.000Z", now)).toBe(false);
  });

  it("is stale when updated exactly 2 months ago", () => {
    expect(isMemoStale("2026-07-16T00:00:00.000Z", now)).toBe(true);
  });

  it("is stale when updated more than 2 months ago", () => {
    expect(isMemoStale("2026-06-01T00:00:00.000Z", now)).toBe(true);
  });

  it("is not stale for a memo updated today", () => {
    expect(isMemoStale("2026-09-16T00:00:00.000Z", now)).toBe(false);
  });
});
