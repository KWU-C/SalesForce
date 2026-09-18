import { afterEach, describe, expect, it, vi } from "vitest";
import type { SalesforceQueryClient } from "@/services/salesforce/salesforceClient";
import { getResourceLoad } from "./resourceLoadRepository";

function fakeClient(rows: unknown[]): SalesforceQueryClient {
  return {
    query: vi.fn().mockResolvedValue(rows),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("getResourceLoad", () => {
  it("maps raw Salesforce rows into deals and computes CR loads for all concrete CRs of the current term", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 8, 18))); // 2026-09-18, term 50 (CR1-4)

    const client = fakeClient([
      { bumonna__c: "CR1", arari__c: 1_200_000, juchuubi__c: "2026-09-01", seikyuubi__c: "2026-09-30" },
    ]);

    const result = await getResourceLoad(client);

    expect(result).not.toBeNull();
    expect(result!.crLoads.map((c) => c.crId)).toEqual(["CR1", "CR2", "CR3", "CR4"]);
    const cr1 = result!.crLoads.find((c) => c.crId === "CR1")!;
    expect(cr1.referenceGrossProfit1m).toBe(1_200_000);
  });

  it("ignores rows with an unrecognized bumonna__c value instead of throwing", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 8, 18)));

    const client = fakeClient([
      { bumonna__c: "CR9", arari__c: 1_000_000, juchuubi__c: "2026-09-01", seikyuubi__c: "2026-09-30" },
    ]);

    const result = await getResourceLoad(client);

    expect(result).not.toBeNull();
    expect(result!.anomalyCount).toBe(0);
    for (const c of result!.crLoads) {
      expect(c.referenceGrossProfit1m).toBe(0);
    }
  });

  it("returns null (not a thrown error) when the query fails", async () => {
    const client: SalesforceQueryClient = { query: vi.fn().mockRejectedValue(new Error("secret leak: token=abc")) };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await getResourceLoad(client);

    expect(result).toBeNull();
    expect(errorSpy).toHaveBeenCalled();
  });
});
