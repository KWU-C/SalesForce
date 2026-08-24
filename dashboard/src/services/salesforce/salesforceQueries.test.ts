import { describe, expect, it } from "vitest";
import {
  buildCompletedClientRankingQuery,
  buildCompletedLeaderRankingQuery,
  buildCompletedProgressQuery,
  buildOrderClientRankingQuery,
  buildOrderLeaderRankingQuery,
  buildOrderProgressQuery,
  buildSalesTargetQuery,
} from "./salesforceQueries";

const dateRange = { start: "2025-09-01", end: "2026-08-31" };

describe("buildOrderProgressQuery", () => {
  it("filters by 受注日(juchuubi__c) + 受注確度A + 失注除外(ユーザー確定の定義、2026-08-17)", () => {
    const soql = buildOrderProgressQuery(dateRange);

    expect(soql).toContain("FROM Process__c");
    expect(soql).toContain("bumonna__c IN ('CR1','CR2','CR3')");
    expect(soql).toContain("juchuubi__c != null");
    expect(soql).toContain("juchukakudo__c = 'A (80～100%)'");
    expect(soql).toContain("phase__c != '失注'");
    expect(soql).toContain("juchuubi__c >= 2025-09-01 AND juchuubi__c <= 2026-08-31");
  });
});

describe("buildCompletedProgressQuery", () => {
  it("filters by 請求日(seikyuubi__c) + 受注確度A + 失注除外(ユーザー確定・検算済みの定義)", () => {
    const soql = buildCompletedProgressQuery(dateRange);

    expect(soql).toContain("FROM Process__c");
    expect(soql).toContain("juchukakudo__c = 'A (80～100%)'");
    expect(soql).toContain("phase__c != '失注'");
    expect(soql).toContain("seikyuubi__c >= 2025-09-01 AND seikyuubi__c <= 2026-08-31");
  });
});

describe("buildSalesTargetQuery", () => {
  it("filters SalesTarget__c by the given fiscal term", () => {
    expect(buildSalesTargetQuery(49)).toBe(
      "SELECT TargetSales__c, TargetGrossProfit__c FROM SalesTarget__c WHERE Term__c = 49 LIMIT 1"
    );
  });
});

describe("buildOrderClientRankingQuery", () => {
  it("selects 受注 detail rows (bumonna__c/clientName__c/clientGroupName__c/arari__c) with the same business filters as the monthly query, without GROUP BY or aliasing", () => {
    const soql = buildOrderClientRankingQuery(dateRange);

    expect(soql).toContain("FROM Process__c");
    expect(soql).toContain("bumonna__c IN ('CR1','CR2','CR3')");
    expect(soql).toContain("juchuubi__c != null");
    expect(soql).toContain("juchukakudo__c = 'A (80～100%)'");
    expect(soql).toContain("phase__c != '失注'");
    expect(soql).toContain("juchuubi__c >= 2025-09-01 AND juchuubi__c <= 2026-08-31");
    expect(soql).toContain("SELECT bumonna__c, clientName__c, clientGroupName__c, arari__c");
    expect(soql).not.toContain("GROUP BY");
    expect(soql).not.toContain("kuraiantomei__c");
    // 列エイリアスは非集計クエリでは使えない("only aggregate expressions use
    // field aliasing"、2026-08-24に本番で実際に踏んだ回帰防止)
    expect(soql).not.toMatch(/clientName__c[ \t]+\w+/);
    expect(soql).not.toMatch(/clientGroupName__c[ \t]+\w+/);
    expect(soql).not.toMatch(/arari__c[ \t]+\w+/);
  });
});

describe("buildCompletedClientRankingQuery", () => {
  it("selects 完了 detail rows using 請求日(seikyuubi__c), without GROUP BY or aliasing", () => {
    const soql = buildCompletedClientRankingQuery(dateRange);

    expect(soql).toContain("seikyuubi__c >= 2025-09-01 AND seikyuubi__c <= 2026-08-31");
    expect(soql).toContain("SELECT bumonna__c, clientName__c, clientGroupName__c, arari__c");
    expect(soql).not.toContain("GROUP BY");
    expect(soql).not.toContain("kuraiantomei__c");
    expect(soql).not.toMatch(/clientName__c[ \t]+\w+/);
    expect(soql).not.toMatch(/clientGroupName__c[ \t]+\w+/);
    expect(soql).not.toMatch(/arari__c[ \t]+\w+/);
  });
});

describe("buildOrderLeaderRankingQuery", () => {
  it("groups 受注 by CR × リーダー(rida__c/rida__r.Name) with the same business filters as the monthly query", () => {
    const soql = buildOrderLeaderRankingQuery(dateRange);

    expect(soql).toContain("FROM Process__c");
    expect(soql).toContain("bumonna__c IN ('CR1','CR2','CR3')");
    expect(soql).toContain("juchuubi__c != null");
    expect(soql).toContain("juchukakudo__c = 'A (80～100%)'");
    expect(soql).toContain("phase__c != '失注'");
    expect(soql).toContain("juchuubi__c >= 2025-09-01 AND juchuubi__c <= 2026-08-31");
    expect(soql).toContain(
      "SELECT bumonna__c crId, rida__c leaderId, rida__r.Name leaderName, SUM(arari__c) grossProfit"
    );
    // 集計クエリ(GROUP BY)なので、クライアントランキングと違いフィールド
    // エイリアシングは合法(2026-08-24確認)
    expect(soql).toContain("GROUP BY bumonna__c, rida__c, rida__r.Name");
  });
});

describe("buildCompletedLeaderRankingQuery", () => {
  it("groups 完了 by CR × リーダー using 請求日(seikyuubi__c)", () => {
    const soql = buildCompletedLeaderRankingQuery(dateRange);

    expect(soql).toContain("seikyuubi__c >= 2025-09-01 AND seikyuubi__c <= 2026-08-31");
    expect(soql).toContain(
      "SELECT bumonna__c crId, rida__c leaderId, rida__r.Name leaderName, SUM(arari__c) grossProfit"
    );
    expect(soql).toContain("GROUP BY bumonna__c, rida__c, rida__r.Name");
  });
});
