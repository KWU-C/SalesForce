import { describe, expect, it } from "vitest";
import { excludeLostExpectedDeals, mapPipelineDealRows, type PipelineDealRow } from "./pipelineDeals";

describe("mapPipelineDealRows", () => {
  it("maps raw SOQL fields to PipelineDeal", () => {
    const rows: PipelineDealRow[] = [
      {
        Id: "a001",
        Name: "案件A",
        clientName__c: "クライアントA",
        juchukakudo__c: "A (80～100%)",
        arari__c: 1000,
        uriagegoukei__c: 3000,
        memo__c: "既存メモ",
      },
    ];

    expect(mapPipelineDealRows(rows)).toEqual([
      {
        processId: "a001",
        confidence: "A (80～100%)",
        clientName: "クライアントA",
        dealName: "案件A",
        grossProfit: 1000,
        sales: 3000,
        salesforceMemo: "既存メモ",
      },
    ]);
  });

  it('falls back juchukakudo__c=null to "未設定"', () => {
    const rows: PipelineDealRow[] = [
      {
        Id: "a002",
        Name: "案件B",
        clientName__c: null,
        juchukakudo__c: null,
        arari__c: null,
        uriagegoukei__c: null,
        memo__c: null,
      },
    ];

    expect(mapPipelineDealRows(rows)[0].confidence).toBe("未設定");
  });
});

describe("excludeLostExpectedDeals", () => {
  function row(overrides: Partial<PipelineDealRow>): PipelineDealRow {
    return {
      Id: "id",
      Name: "案件",
      clientName__c: "クライアント",
      juchukakudo__c: "A (80～100%)",
      arari__c: 100,
      uriagegoukei__c: 200,
      memo__c: null,
      ...overrides,
    };
  }

  it("excludes rows whose memo__c is exactly '失注予定'", () => {
    const rows = [row({ Id: "a", memo__c: "失注予定" }), row({ Id: "b", memo__c: "通常のメモ" })];
    expect(excludeLostExpectedDeals(rows).map((r) => r.Id)).toEqual(["b"]);
  });

  it("keeps rows with a null memo__c (matches SOQL's != semantics, which also includes nulls)", () => {
    const rows = [row({ Id: "a", memo__c: null })];
    expect(excludeLostExpectedDeals(rows).map((r) => r.Id)).toEqual(["a"]);
  });
});
