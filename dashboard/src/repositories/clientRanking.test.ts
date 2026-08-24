import { describe, expect, it } from "vitest";
import { rankClients, type ClientAggregateRow } from "./clientRanking";

const NAMES = new Map([
  ["c1", "株式会社A"],
  ["c2", "株式会社B"],
  ["c3", "株式会社C"],
]);

describe("rankClients", () => {
  it("sorts descending by grossProfit and attaches the resolved client name", () => {
    const rows: ClientAggregateRow[] = [
      { crId: "CR1", clientId: "c1", grossProfit: 100 },
      { crId: "CR1", clientId: "c2", grossProfit: 300 },
      { crId: "CR1", clientId: "c3", grossProfit: 200 },
    ];

    const result = rankClients(rows, "CR1", NAMES, new Set());

    expect(result.map((r) => r.clientId)).toEqual(["c2", "c3", "c1"]);
    expect(result[0].clientName).toBe("株式会社B");
    expect(result[0].grossProfit).toBe(300);
  });

  it("filters to the given CR only when crId is not ALL", () => {
    const rows: ClientAggregateRow[] = [
      { crId: "CR1", clientId: "c1", grossProfit: 100 },
      { crId: "CR2", clientId: "c2", grossProfit: 999 },
    ];

    const result = rankClients(rows, "CR1", NAMES, new Set());

    expect(result).toHaveLength(1);
    expect(result[0].clientId).toBe("c1");
  });

  it("ALL re-aggregates the same client across CRs instead of listing it twice", () => {
    const rows: ClientAggregateRow[] = [
      { crId: "CR1", clientId: "c1", grossProfit: 100 },
      { crId: "CR2", clientId: "c1", grossProfit: 50 },
      { crId: "CR3", clientId: "c2", grossProfit: 80 },
    ];

    const result = rankClients(rows, "ALL", NAMES, new Set());

    expect(result).toHaveLength(2);
    const c1 = result.find((r) => r.clientId === "c1")!;
    expect(c1.grossProfit).toBe(150);
  });

  it("marks isNewThisTerm from the given client-id set", () => {
    const rows: ClientAggregateRow[] = [
      { crId: "CR1", clientId: "c1", grossProfit: 100 },
      { crId: "CR1", clientId: "c2", grossProfit: 90 },
    ];

    const result = rankClients(rows, "CR1", NAMES, new Set(["c2"]));

    expect(result.find((r) => r.clientId === "c1")!.isNewThisTerm).toBe(false);
    expect(result.find((r) => r.clientId === "c2")!.isNewThisTerm).toBe(true);
  });

  it("caps the result at the given limit (default 20)", () => {
    const rows: ClientAggregateRow[] = Array.from({ length: 30 }, (_, i) => ({
      crId: "CR1",
      clientId: `c${i}`,
      grossProfit: i,
    }));

    expect(rankClients(rows, "CR1", new Map(), new Set())).toHaveLength(20);
    expect(rankClients(rows, "CR1", new Map(), new Set(), 5)).toHaveLength(5);
  });

  it("falls back to the raw clientId as the name when no Account name was resolved", () => {
    const rows: ClientAggregateRow[] = [{ crId: "CR1", clientId: "unknown-id", grossProfit: 10 }];

    const result = rankClients(rows, "CR1", new Map(), new Set());

    expect(result[0].clientName).toBe("unknown-id");
  });
});
