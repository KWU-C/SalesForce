import { describe, expect, it } from "vitest";
import { resolveHighlighted } from "./resolveHighlighted";

describe("resolveHighlighted", () => {
  it("checks the box when the memo starts with ● and the dashboard has never been manually toggled", () => {
    expect(
      resolveHighlighted({
        salesforceMemo: "●対応中",
        salesforceMemoUpdatedAt: "2026-09-01T00:00:00.000Z",
        dashboardHighlighted: false,
        dashboardHighlightedUpdatedAt: undefined,
      })
    ).toBe(true);
  });

  it("leaves the box unchecked when there is no ● and the dashboard has never been manually toggled", () => {
    expect(
      resolveHighlighted({
        salesforceMemo: "普通のメモ",
        salesforceMemoUpdatedAt: "2026-09-01T00:00:00.000Z",
        dashboardHighlighted: false,
        dashboardHighlightedUpdatedAt: undefined,
      })
    ).toBe(false);
  });

  it("ignores leading whitespace before the ●", () => {
    expect(
      resolveHighlighted({
        salesforceMemo: "  ●対応中",
        salesforceMemoUpdatedAt: "2026-09-01T00:00:00.000Z",
        dashboardHighlighted: false,
        dashboardHighlightedUpdatedAt: undefined,
      })
    ).toBe(true);
  });

  it("does not match a ● that is not at the start of the memo", () => {
    expect(
      resolveHighlighted({
        salesforceMemo: "対応中●",
        salesforceMemoUpdatedAt: "2026-09-01T00:00:00.000Z",
        dashboardHighlighted: false,
        dashboardHighlightedUpdatedAt: undefined,
      })
    ).toBe(false);
  });

  it("has no conflict (and keeps the value) when the manually-toggled dashboard state already agrees with the bullet", () => {
    expect(
      resolveHighlighted({
        salesforceMemo: "●対応中",
        salesforceMemoUpdatedAt: "2026-09-01T00:00:00.000Z",
        dashboardHighlighted: true,
        dashboardHighlightedUpdatedAt: "2026-08-01T00:00:00.000Z",
      })
    ).toBe(true);
  });

  it("prefers the dashboard's manual uncheck when it happened after the ● was added", () => {
    expect(
      resolveHighlighted({
        salesforceMemo: "●対応中",
        salesforceMemoUpdatedAt: "2026-09-01T00:00:00.000Z",
        dashboardHighlighted: false,
        dashboardHighlightedUpdatedAt: "2026-09-05T00:00:00.000Z",
      })
    ).toBe(false);
  });

  it("re-adopts the ● once the Salesforce memo is updated again after the manual uncheck", () => {
    expect(
      resolveHighlighted({
        salesforceMemo: "●対応中",
        salesforceMemoUpdatedAt: "2026-09-10T00:00:00.000Z",
        dashboardHighlighted: false,
        dashboardHighlightedUpdatedAt: "2026-09-05T00:00:00.000Z",
      })
    ).toBe(true);
  });

  it("prefers a manual check that happened after the ● was removed from the memo", () => {
    expect(
      resolveHighlighted({
        salesforceMemo: "対応済み",
        salesforceMemoUpdatedAt: "2026-09-01T00:00:00.000Z",
        dashboardHighlighted: true,
        dashboardHighlightedUpdatedAt: "2026-09-05T00:00:00.000Z",
      })
    ).toBe(true);
  });
});
