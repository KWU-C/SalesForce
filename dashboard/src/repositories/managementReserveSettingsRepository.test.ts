import { describe, expect, it } from "vitest";
import { listManagementReserveSettings } from "./managementReserveSettingsRepository";

describe("listManagementReserveSettings", () => {
  it("returns parsed settings and drops malformed documents", async () => {
    const store = {
      listAll: async () => [
        { asOf: "2026-10-05", consumptionTaxReserve: 75, bonusReserve: 90, overdraftLimits: [] },
        { consumptionTaxReserve: 75 },
        "broken",
      ],
    };
    const result = await listManagementReserveSettings(store);
    expect(result.map((s) => s.asOf)).toEqual(["2026-10-05"]);
  });

  it("returns an empty list when the collection is empty", async () => {
    expect(await listManagementReserveSettings({ listAll: async () => [] })).toEqual([]);
  });
});
