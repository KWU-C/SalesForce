import { afterEach, describe, expect, it, vi } from "vitest";
import type { SalesforceQueryClient } from "@/services/salesforce/salesforceClient";
import { getClientTargetProgress } from "./clientTargetRepository";

function fakeClient(responses: Record<string, unknown[]>): SalesforceQueryClient {
  return {
    async query<T>(soql: string): Promise<T[]> {
      if (soql.includes("FROM Profit__c")) return responses.targets as T[];
      if (soql.includes("FROM SalesTarget__c")) return responses.salesTarget as T[];
      if (soql.includes("seikyuubi__c >=")) return responses.completed as T[];
      return responses.orders as T[];
    },
  };
}

afterEach(() => vi.restoreAllMocks());

describe("getClientTargetProgress", () => {
  it("maps raw Salesforce rows and SalesTarget__c CR targets into scopes", async () => {
    const client = fakeClient({
      targets: [
        { bumon__c: "CR1", clientName__c: "顧客A", kobetsuuriagebi__c: "2026-10-01", mokuhyoarari__c: 100 },
        // 想定外のCR値は除外する
        { bumon__c: "CR9", clientName__c: "顧客X", kobetsuuriagebi__c: "2026-10-01", mokuhyoarari__c: 999 },
      ],
      completed: [{ bumonna__c: "CR1", clientName__c: "顧客A", seikyuubi__c: "2026-10-15", arari__c: 60 }],
      orders: [{ bumonna__c: "CR1", clientName__c: "顧客B", juchuubi__c: "2026-09-15", arari__c: 40 }],
      salesTarget: [{ CR1TargetGrossProfit__c: 300 }],
    });

    const scopes = await getClientTargetProgress(50, ["CR1"], 10, client);
    const cr1 = scopes!.find((s) => s.scopeId === "CR1")!;

    expect(cr1.summary.annualTarget).toBe(100);
    expect(cr1.summary.monthRate).toBe(60);
    expect(cr1.summary.crTargetGap).toBe(200);
    expect(cr1.untargetedClients.map((r) => [r.clientName, r.orderToDate])).toEqual([["顧客B", 40]]);
  });

  it("returns null without logging amounts when a query fails", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const client: SalesforceQueryClient = {
      query: () => Promise.reject(new Error("INVALID_TYPE: sObject type 'Profit__c' is not supported")),
    };

    expect(await getClientTargetProgress(50, ["CR1"], 10, client)).toBeNull();
    expect(errorLog).toHaveBeenCalledTimes(1);
    expect(String(errorLog.mock.calls[0][0])).not.toContain("Profit__c");
  });
});
