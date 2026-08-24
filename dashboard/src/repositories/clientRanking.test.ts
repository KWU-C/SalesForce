import { describe, expect, it } from "vitest";
import { rankClients, type ClientDetailRow } from "./clientRanking";

describe("rankClients", () => {
  it("sums per-record grossProfit by clientName and sorts descending", () => {
    const rows: ClientDetailRow[] = [
      { crId: "CR1", clientName: "株式会社A", grossProfit: 100 },
      { crId: "CR1", clientName: "株式会社B", grossProfit: 300 },
      { crId: "CR1", clientName: "株式会社A", grossProfit: 50 },
    ];

    const result = rankClients(rows, "CR1");

    expect(result.map((r) => r.clientName)).toEqual(["株式会社B", "株式会社A"]);
    expect(result[1].grossProfit).toBe(150);
  });

  it("filters to the given CR only when crId is not ALL", () => {
    const rows: ClientDetailRow[] = [
      { crId: "CR1", clientName: "株式会社A", grossProfit: 100 },
      { crId: "CR2", clientName: "株式会社B", grossProfit: 999 },
    ];

    const result = rankClients(rows, "CR1");

    expect(result).toHaveLength(1);
    expect(result[0].clientName).toBe("株式会社A");
  });

  it("ALL re-aggregates the same client name across CRs instead of listing it twice", () => {
    const rows: ClientDetailRow[] = [
      { crId: "CR1", clientName: "株式会社A", grossProfit: 100 },
      { crId: "CR2", clientName: "株式会社A", grossProfit: 50 },
      { crId: "CR3", clientName: "株式会社B", grossProfit: 80 },
    ];

    const result = rankClients(rows, "ALL");

    expect(result).toHaveLength(2);
    expect(result.find((r) => r.clientName === "株式会社A")!.grossProfit).toBe(150);
  });

  it("skips rows with no client name (kuraiantomei__c not set on the record)", () => {
    const rows: ClientDetailRow[] = [
      { crId: "CR1", clientName: null, grossProfit: 500 },
      { crId: "CR1", clientName: "株式会社A", grossProfit: 100 },
    ];

    const result = rankClients(rows, "CR1");

    expect(result).toHaveLength(1);
    expect(result[0].clientName).toBe("株式会社A");
  });

  it("treats a null grossProfit record as a 0 contribution rather than dropping the client", () => {
    const rows: ClientDetailRow[] = [
      { crId: "CR1", clientName: "株式会社A", grossProfit: null },
      { crId: "CR1", clientName: "株式会社A", grossProfit: 100 },
    ];

    const result = rankClients(rows, "CR1");

    expect(result[0].grossProfit).toBe(100);
  });

  it("always reports isNewThisTerm as false (新規判定は現状未対応、2026-08-24)", () => {
    const rows: ClientDetailRow[] = [{ crId: "CR1", clientName: "株式会社A", grossProfit: 100 }];

    expect(rankClients(rows, "CR1")[0].isNewThisTerm).toBe(false);
  });

  it("caps the result at the given limit (default 20)", () => {
    const rows: ClientDetailRow[] = Array.from({ length: 30 }, (_, i) => ({
      crId: "CR1",
      clientName: `株式会社${i}`,
      grossProfit: i,
    }));

    expect(rankClients(rows, "CR1")).toHaveLength(20);
    expect(rankClients(rows, "CR1", 5)).toHaveLength(5);
  });
});
