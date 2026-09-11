import { describe, expect, it } from "vitest";
import { mapPipelineDealRows, type PipelineDealRow } from "./pipelineDeals";

describe("mapPipelineDealRows", () => {
  it("maps raw SOQL fields to PipelineDeal", () => {
    const rows: PipelineDealRow[] = [
      {
        Id: "a001",
        Name: "案件A",
        clientName__c: "クライアントA",
        juchukakudo__c: "A (80～100%)",
        arari__c: 1000,
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
        memo__c: null,
      },
    ];

    expect(mapPipelineDealRows(rows)[0].confidence).toBe("未設定");
  });
});
