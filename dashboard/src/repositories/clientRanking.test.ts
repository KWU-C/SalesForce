import { describe, expect, it } from "vitest";
import { rankClients, type ClientDetailRow } from "./clientRanking";

function row(overrides: Partial<ClientDetailRow> = {}): ClientDetailRow {
  return { crId: "CR1", clientName: "株式会社A", clientGroupName: null, grossProfit: 100, ...overrides };
}

describe("rankClients", () => {
  it("sums per-record grossProfit by clientName and sorts descending", () => {
    const rows: ClientDetailRow[] = [
      row({ clientName: "株式会社A", grossProfit: 100 }),
      row({ clientName: "株式会社B", grossProfit: 300 }),
      row({ clientName: "株式会社A", grossProfit: 50 }),
    ];

    const result = rankClients(rows, "CR1", "49期新規");

    expect(result.map((r) => r.clientName)).toEqual(["株式会社B", "株式会社A"]);
    expect(result[1].grossProfit).toBe(150);
  });

  it("filters to the given CR only when crId is not ALL", () => {
    const rows: ClientDetailRow[] = [
      row({ crId: "CR1", clientName: "株式会社A", grossProfit: 100 }),
      row({ crId: "CR2", clientName: "株式会社B", grossProfit: 999 }),
    ];

    const result = rankClients(rows, "CR1", "49期新規");

    expect(result).toHaveLength(1);
    expect(result[0].clientName).toBe("株式会社A");
  });

  it("ALL re-aggregates the same client name across CRs instead of listing it twice", () => {
    const rows: ClientDetailRow[] = [
      row({ crId: "CR1", clientName: "株式会社A", grossProfit: 100 }),
      row({ crId: "CR2", clientName: "株式会社A", grossProfit: 50 }),
      row({ crId: "CR3", clientName: "株式会社B", grossProfit: 80 }),
    ];

    const result = rankClients(rows, "ALL", "49期新規");

    expect(result).toHaveLength(2);
    expect(result.find((r) => r.clientName === "株式会社A")!.grossProfit).toBe(150);
  });

  it("skips rows with no client name (kuraiantomei__c not set on the record)", () => {
    const rows: ClientDetailRow[] = [
      row({ clientName: null, grossProfit: 500 }),
      row({ clientName: "株式会社A", grossProfit: 100 }),
    ];

    const result = rankClients(rows, "CR1", "49期新規");

    expect(result).toHaveLength(1);
    expect(result[0].clientName).toBe("株式会社A");
  });

  it("treats a null grossProfit record as a 0 contribution rather than dropping the client", () => {
    const rows: ClientDetailRow[] = [
      row({ clientName: "株式会社A", grossProfit: null }),
      row({ clientName: "株式会社A", grossProfit: 100 }),
    ];

    const result = rankClients(rows, "CR1", "49期新規");

    expect(result[0].grossProfit).toBe(100);
  });

  it("marks isNewThisTerm true when clientGroupName contains the given marker", () => {
    const rows: ClientDetailRow[] = [
      row({ clientName: "株式会社A", clientGroupName: "49期新規" }),
      row({ clientName: "株式会社B", clientGroupName: "Ｃグループ" }),
      row({ clientName: "株式会社C", clientGroupName: null }),
      // 複合表記("Ｃグループ（45期新規）"のような実データのパターン)も部分一致で拾う
      row({ clientName: "株式会社D", clientGroupName: "Ｃグループ（49期新規）" }),
    ];

    const result = rankClients(rows, "CR1", "49期新規");

    expect(result.find((r) => r.clientName === "株式会社A")!.isNewThisTerm).toBe(true);
    expect(result.find((r) => r.clientName === "株式会社B")!.isNewThisTerm).toBe(false);
    expect(result.find((r) => r.clientName === "株式会社C")!.isNewThisTerm).toBe(false);
    expect(result.find((r) => r.clientName === "株式会社D")!.isNewThisTerm).toBe(true);
  });

  it("uses a different term's marker without matching the wrong term (no hardcoding)", () => {
    const rows: ClientDetailRow[] = [row({ clientName: "株式会社A", clientGroupName: "48期新規" })];

    // 49期のマーカーで検索した場合は一致しない
    expect(rankClients(rows, "CR1", "49期新規")[0].isNewThisTerm).toBe(false);
    // 48期のマーカーなら一致する
    expect(rankClients(rows, "CR1", "48期新規")[0].isNewThisTerm).toBe(true);
  });

  it("ORs isNewThisTerm across multiple records for the same client (any matching row is enough)", () => {
    const rows: ClientDetailRow[] = [
      row({ clientName: "株式会社A", clientGroupName: null, grossProfit: 10 }),
      row({ clientName: "株式会社A", clientGroupName: "49期新規", grossProfit: 20 }),
    ];

    expect(rankClients(rows, "CR1", "49期新規")[0].isNewThisTerm).toBe(true);
  });

  it("caps the result at the given limit (default 20)", () => {
    const rows: ClientDetailRow[] = Array.from({ length: 30 }, (_, i) =>
      row({ clientName: `株式会社${i}`, grossProfit: i })
    );

    expect(rankClients(rows, "CR1", "49期新規")).toHaveLength(20);
    expect(rankClients(rows, "CR1", "49期新規", 5)).toHaveLength(5);
  });
});
