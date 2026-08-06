import { describe, expect, it } from "vitest";
import { parseCompanyProgressReport } from "./companyProgressReportParser";

describe("parseCompanyProgressReport", () => {
  it("uses the 受注/完了 block structure when present (CRシートと同じ構造の場合)", () => {
    const grid = [
      ["受注", "", "", "完了", "", ""],
      ["", "9月", "10月", "", "9月", "10月"],
      ["売上", "100", "110", "売上", "150", "160"],
      ["粗利", "30", "33", "粗利", "45", "48"],
      ["目標粗利", "40", "40", "目標粗利", "50", "50"],
    ];

    const result = parseCompanyProgressReport(grid);

    expect(result.order).toEqual([
      { crId: "ALL", kind: "order", month: 9, sales: 100, grossProfit: 30, targetGrossProfit: 40, achievementRate: 75 },
      { crId: "ALL", kind: "order", month: 10, sales: 110, grossProfit: 33, targetGrossProfit: 40, achievementRate: 82.5 },
    ]);
    expect(result.completed).toEqual([
      { crId: "ALL", kind: "completed", month: 9, sales: 150, grossProfit: 45, targetGrossProfit: 50, achievementRate: 90 },
      { crId: "ALL", kind: "completed", month: 10, sales: 160, grossProfit: 48, targetGrossProfit: 50, achievementRate: 96 },
    ]);
  });

  it("falls back to a single block when 受注/完了 labels are absent (構造が異なる場合のフォールバック)", () => {
    const grid = [
      ["", "9月", "10月"],
      ["売上", "100", "110"],
      ["粗利", "30", "33"],
      ["目標粗利", "40", "40"],
    ];

    const result = parseCompanyProgressReport(grid);

    expect(result.order).toBeNull();
    expect(result.completed).toEqual([
      { crId: "ALL", kind: "completed", month: 9, sales: 100, grossProfit: 30, targetGrossProfit: 40, achievementRate: 75 },
      { crId: "ALL", kind: "completed", month: 10, sales: 110, grossProfit: 33, targetGrossProfit: 40, achievementRate: 82.5 },
    ]);
    expect(result.warnings[0]).toMatch(/単一ブロックとして解析/);
  });
});
