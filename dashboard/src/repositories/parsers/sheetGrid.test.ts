import { describe, expect, it } from "vitest";
import {
  findCellsInRegion,
  findSingleCell,
  fullRegion,
  maxColumnIndex,
  SheetParseError,
} from "./sheetGrid";

describe("sheetGrid", () => {
  const grid = [
    ["A", "B", "A"],
    ["C", "D", ""],
  ];

  it("fullRegion covers the entire grid including ragged rows", () => {
    expect(fullRegion(grid)).toEqual({ rowStart: 0, rowEnd: 1, colStart: 0, colEnd: 2 });
  });

  it("maxColumnIndex uses the widest row", () => {
    expect(maxColumnIndex([["a"], ["a", "b", "c"]])).toBe(2);
  });

  it("findCellsInRegion finds every match", () => {
    expect(findCellsInRegion(grid, "A", fullRegion(grid))).toEqual([
      { row: 0, col: 0 },
      { row: 0, col: 2 },
    ]);
  });

  it("findCellsInRegion is scoped to the given column range", () => {
    const region = { rowStart: 0, rowEnd: 1, colStart: 0, colEnd: 0 };
    expect(findCellsInRegion(grid, "A", region)).toEqual([{ row: 0, col: 0 }]);
  });

  it("findSingleCell throws when the label is missing", () => {
    expect(() => findSingleCell(grid, "Z", fullRegion(grid), "テスト領域")).toThrow(
      SheetParseError
    );
    expect(() => findSingleCell(grid, "Z", fullRegion(grid), "テスト領域")).toThrow(/Z/);
  });

  it("findSingleCell throws when the label is ambiguous", () => {
    expect(() => findSingleCell(grid, "A", fullRegion(grid), "テスト領域")).toThrow(
      SheetParseError
    );
  });

  it("trims whitespace when matching labels", () => {
    const padded = [[" A ", "B"]];
    expect(findCellsInRegion(padded, "A", fullRegion(padded))).toEqual([{ row: 0, col: 0 }]);
  });
});
