import { describe, expect, it } from "vitest";
import { mapRecordsToMonthlyProgress } from "./googleSheetsRecordMapper";

describe("mapRecordsToMonthlyProgress", () => {
  it("parses yen-formatted numbers and computes achievementRate when absent", () => {
    const records = [
      { 月: "9月", 売上: "¥32,902,722", 粗利: "10,476,739", 目標粗利: "10,560,000" },
    ];

    const result = mapRecordsToMonthlyProgress(records, "CR1", "order");

    expect(result).toEqual([
      {
        crId: "CR1",
        kind: "order",
        month: 9,
        sales: 32_902_722,
        grossProfit: 10_476_739,
        targetGrossProfit: 10_560_000,
        achievementRate: 99.2,
      },
    ]);
  });

  it("uses the sheet's own achievementRate column when present", () => {
    const records = [
      { 月: "9", 売上: "100", 粗利: "30", 目標粗利: "40", 粗利達成率: "75" },
    ];

    const [row] = mapRecordsToMonthlyProgress(records, "CR2", "completed");
    expect(row.achievementRate).toBe(75);
  });

  it("skips rows without a parseable month (小計行など)", () => {
    const records = [
      { 月: "9月", 売上: "100", 粗利: "30", 目標粗利: "40" },
      { 月: "合計", 売上: "100", 粗利: "30", 目標粗利: "40" },
      { 月: "", 売上: "", 粗利: "", 目標粗利: "" },
    ];

    expect(mapRecordsToMonthlyProgress(records, "CR3", "order")).toHaveLength(1);
  });

  it("treats missing numeric cells as zero", () => {
    const records = [{ 月: "12月", 売上: "", 粗利: "", 目標粗利: "11,220,000" }];
    const [row] = mapRecordsToMonthlyProgress(records, "CR1", "order");

    expect(row.sales).toBe(0);
    expect(row.grossProfit).toBe(0);
    expect(row.achievementRate).toBe(0);
  });
});
