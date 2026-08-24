import { describe, expect, it } from "vitest";
import { rankLeaders, type LeaderAggregateRow } from "./leaderRanking";

function row(overrides: Partial<LeaderAggregateRow> = {}): LeaderAggregateRow {
  return { crId: "CR1", leaderId: "005AAA", leaderName: "青木 睦", grossProfit: 100, ...overrides };
}

describe("rankLeaders", () => {
  it("sorts descending by grossProfit", () => {
    const rows: LeaderAggregateRow[] = [
      row({ leaderId: "005AAA", leaderName: "青木 睦", grossProfit: 100 }),
      row({ leaderId: "005BBB", leaderName: "山田 太郎", grossProfit: 300 }),
    ];

    const result = rankLeaders(rows, "CR1");

    expect(result.map((r) => r.leaderName)).toEqual(["山田 太郎", "青木 睦"]);
  });

  it("filters to the given CR only when crId is not ALL", () => {
    const rows: LeaderAggregateRow[] = [
      row({ crId: "CR1", leaderId: "005AAA", grossProfit: 100 }),
      row({ crId: "CR2", leaderId: "005BBB", grossProfit: 999 }),
    ];

    const result = rankLeaders(rows, "CR1");

    expect(result).toHaveLength(1);
    expect(result[0].leaderId).toBe("005AAA");
  });

  it("ALL re-aggregates the same leader across CRs by leaderId (stable id, unlike client name)", () => {
    const rows: LeaderAggregateRow[] = [
      row({ crId: "CR1", leaderId: "005AAA", grossProfit: 100 }),
      row({ crId: "CR2", leaderId: "005AAA", grossProfit: 50 }),
      row({ crId: "CR3", leaderId: "005BBB", grossProfit: 80 }),
    ];

    const result = rankLeaders(rows, "ALL");

    expect(result).toHaveLength(2);
    expect(result.find((r) => r.leaderId === "005AAA")!.grossProfit).toBe(150);
  });

  it("skips rows with no leaderId (rida__c not set on the record)", () => {
    const rows: LeaderAggregateRow[] = [
      row({ leaderId: null, leaderName: null, grossProfit: 500 }),
      row({ leaderId: "005AAA", grossProfit: 100 }),
    ];

    const result = rankLeaders(rows, "CR1");

    expect(result).toHaveLength(1);
    expect(result[0].leaderId).toBe("005AAA");
  });

  it("caps the result at the given limit (default 20)", () => {
    const rows: LeaderAggregateRow[] = Array.from({ length: 25 }, (_, i) =>
      row({ leaderId: `005-${i}`, grossProfit: i })
    );

    expect(rankLeaders(rows, "CR1")).toHaveLength(20);
    expect(rankLeaders(rows, "CR1", 5)).toHaveLength(5);
  });
});
