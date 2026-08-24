import { describe, expect, it } from "vitest";
import {
  buildCompletedClientRankingQuery,
  buildCompletedProgressQuery,
  buildOrderClientRankingQuery,
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
  it("selects 受注 detail rows (crId/clientName__c/arari__c) with the same business filters as the monthly query, without GROUP BY", () => {
    const soql = buildOrderClientRankingQuery(dateRange);

    expect(soql).toContain("FROM Process__c");
    expect(soql).toContain("bumonna__c IN ('CR1','CR2','CR3')");
    expect(soql).toContain("juchuubi__c != null");
    expect(soql).toContain("juchukakudo__c = 'A (80～100%)'");
    expect(soql).toContain("phase__c != '失注'");
    expect(soql).toContain("juchuubi__c >= 2025-09-01 AND juchuubi__c <= 2026-08-31");
    expect(soql).toContain("clientName__c clientName");
    // clientName__cはSOQLのGROUP BY対象にできないため明細のまま取得する（アプリ側で合算）
    expect(soql).not.toContain("GROUP BY");
    expect(soql).not.toContain("kuraiantomei__c");
  });
});

describe("buildCompletedClientRankingQuery", () => {
  it("selects 完了 detail rows using 請求日(seikyuubi__c), without GROUP BY", () => {
    const soql = buildCompletedClientRankingQuery(dateRange);

    expect(soql).toContain("seikyuubi__c >= 2025-09-01 AND seikyuubi__c <= 2026-08-31");
    expect(soql).toContain("clientName__c clientName");
    expect(soql).not.toContain("GROUP BY");
    expect(soql).not.toContain("kuraiantomei__c");
  });
});
