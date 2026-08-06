import { describe, expect, it } from "vitest";
import { createDefaultReportRegistry } from "./reportDefinitions";

describe("createDefaultReportRegistry", () => {
  it("identifies a CR-style report even though it also satisfies 全社推移's looser labels", () => {
    const registry = createDefaultReportRegistry();
    const grid = [
      ["受注", "", "", "", "", "完了", "", "", "", ""],
      ["", "9月", "10月", "11月", "第1四半期", "", "9月", "10月", "11月", "第1四半期"],
      ["売上", "100", "110", "120", "330", "売上", "150", "160", "170", "480"],
      ["粗利", "30", "33", "36", "99", "粗利", "45", "48", "51", "144"],
      ["目標粗利", "40", "40", "40", "120", "目標粗利", "50", "50", "50", "150"],
    ];

    expect(registry.identify(grid)).toBe("CR別月次営業まとめ");

    const result = registry.parse(grid, { crId: "CR1" });
    expect(result.order).toHaveLength(3);
    expect(result.completed).toHaveLength(3);
  });

  it("identifies a normalized table (1行目ヘッダー)", () => {
    const registry = createDefaultReportRegistry();
    const grid = [
      ["月", "売上", "粗利", "目標粗利"],
      ["9月", "100", "30", "40"],
    ];

    expect(registry.identify(grid)).toBe("正規化テーブル");

    const result = registry.parse(grid, { crId: "CR1", kind: "order" });
    expect(result.order).toEqual([
      { crId: "CR1", kind: "order", month: 9, sales: 100, grossProfit: 30, targetGrossProfit: 40, achievementRate: 75 },
    ]);
    expect(result.completed).toBeNull();
  });

  it("falls back to 全社推移 when only the looser labels are present (no 受注/完了 split)", () => {
    const registry = createDefaultReportRegistry();
    const grid = [
      ["", "9月", "10月"],
      ["売上", "100", "110"],
      ["粗利", "30", "33"],
      ["目標粗利", "40", "40"],
    ];

    expect(registry.identify(grid)).toBe("全社推移");

    const result = registry.parse(grid, { crId: "ALL" });
    expect(result.order).toBeNull();
    expect(result.completed).toHaveLength(2);
  });
});
