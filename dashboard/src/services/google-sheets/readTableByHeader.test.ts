import { describe, expect, it } from "vitest";
import { indexRowsByHeader } from "./readTableByHeader";

describe("indexRowsByHeader", () => {
  it("maps rows to header-keyed records in the original column order", () => {
    const rows = [
      ["月", "売上", "粗利", "目標粗利"],
      ["9月", "32,902,722", "10,476,739", "10,560,000"],
    ];

    expect(indexRowsByHeader(rows)).toEqual([
      { 月: "9月", 売上: "32,902,722", 粗利: "10,476,739", 目標粗利: "10,560,000" },
    ]);
  });

  it("is unaffected by column reordering (列順変更に耐える)", () => {
    const original = [
      ["月", "売上", "粗利", "目標粗利"],
      ["9月", "100", "30", "40"],
    ];
    const reordered = [
      ["粗利", "月", "目標粗利", "売上"],
      ["30", "9月", "40", "100"],
    ];

    expect(indexRowsByHeader(reordered)).toEqual(indexRowsByHeader(original));
  });

  it("ignores newly inserted columns (列追加に耐える)", () => {
    const rows = [
      ["月", "担当者", "売上", "粗利", "目標粗利", "備考"],
      ["9月", "山田", "100", "30", "40", "特記事項なし"],
    ];

    expect(indexRowsByHeader(rows)).toEqual([
      { 月: "9月", 担当者: "山田", 売上: "100", 粗利: "30", 目標粗利: "40", 備考: "特記事項なし" },
    ]);
  });

  it("still finds a column after it moves to a different position (列移動に耐える)", () => {
    const rows = [
      ["粗利達成率", "月", "売上", "粗利", "目標粗利"],
      ["99.2%", "9月", "100", "30", "40"],
    ];

    const [record] = indexRowsByHeader(rows);
    expect(record["粗利達成率"]).toBe("99.2%");
    expect(record["月"]).toBe("9月");
  });

  it("skips blank rows", () => {
    const rows = [
      ["月", "売上"],
      ["9月", "100"],
      ["", ""],
      ["10月", "200"],
    ];

    expect(indexRowsByHeader(rows)).toHaveLength(2);
  });

  it("returns an empty array when there is no data", () => {
    expect(indexRowsByHeader([])).toEqual([]);
  });
});
