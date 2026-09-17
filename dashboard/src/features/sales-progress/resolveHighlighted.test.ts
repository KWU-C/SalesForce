import { describe, expect, it } from "vitest";
import type { PipelineDeal, ProcessMemo } from "@/domain/types";
import { resolveHighlighted, sortHighlightedFirst } from "./resolveHighlighted";

function deal(overrides: Partial<PipelineDeal> & { processId: string }): PipelineDeal {
  return {
    confidence: "A (80～100%)",
    clientName: "クライアント",
    dealName: "案件",
    grossProfit: 100,
    sales: 300,
    salesforceMemo: null,
    salesforceMemoUpdatedAt: "2026-08-15T02:30:00.000Z",
    ...overrides,
  };
}

function memo(overrides: Partial<ProcessMemo> & { processId: string }): ProcessMemo {
  return {
    crId: "CR1",
    memo: "",
    highlighted: false,
    updatedBy: "test@tcd.jp",
    updatedAt: "2026-09-01T00:00:00.000Z",
    highlightedUpdatedAt: undefined,
    ...overrides,
  };
}

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

describe("sortHighlightedFirst", () => {
  it("moves checked deals to the top, keeping unchecked deals in their original relative order", () => {
    const deals = [
      deal({ processId: "a", clientName: "A社" }),
      deal({ processId: "b", clientName: "B社", salesforceMemo: "●対応中" }),
      deal({ processId: "c", clientName: "C社" }),
      deal({ processId: "d", clientName: "D社", salesforceMemo: "●対応中" }),
    ];

    const sorted = sortHighlightedFirst(deals, {});

    expect(sorted.map((d) => d.processId)).toEqual(["b", "d", "a", "c"]);
  });

  it("keeps the original order unchanged when nothing is checked", () => {
    const deals = [deal({ processId: "a" }), deal({ processId: "b" }), deal({ processId: "c" })];

    const sorted = sortHighlightedFirst(deals, {});

    expect(sorted.map((d) => d.processId)).toEqual(["a", "b", "c"]);
  });

  it("uses the dashboard's manual highlighted flag, not just the ● marker", () => {
    const deals = [
      deal({ processId: "a" }),
      deal({ processId: "b" }),
      deal({ processId: "c" }),
    ];

    const sorted = sortHighlightedFirst(deals, {
      c: memo({ processId: "c", highlighted: true, highlightedUpdatedAt: "2026-09-10T00:00:00.000Z" }),
    });

    expect(sorted.map((d) => d.processId)).toEqual(["c", "a", "b"]);
  });

  it("does not mutate the input array", () => {
    const deals = [deal({ processId: "a" }), deal({ processId: "b", salesforceMemo: "●対応中" })];

    sortHighlightedFirst(deals, {});

    expect(deals.map((d) => d.processId)).toEqual(["a", "b"]);
  });
});
