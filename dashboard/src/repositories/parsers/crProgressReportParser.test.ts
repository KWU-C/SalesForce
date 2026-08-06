import { describe, expect, it } from "vitest";
import { parseCrProgressReport } from "./crProgressReportParser";
import { SheetParseError } from "./sheetGrid";

/**
 * 帳票形式の最小サンプル（受注/完了が左右のブロック、月が横方向、
 * 売上・粗利・目標粗利・粗利達成率が行方向）。
 *
 * col:  0        1     2      3      4          5        6     7      8      9
 *       受注     9月   10月   11月   第1四半期  完了     9月   10月   11月   第1四半期
 * row2: 売上     100   110    120    330        売上     150   160    170    480
 * row3: 粗利     30    33     36     99         粗利     45    48     51     144
 * row4: 目標粗利 40    40     40     120        目標粗利 50    50     50     150
 * row5: 粗利達成率 75  82.5   90     82.5       粗利達成率 90   96    102    96
 */
function buildBaseGrid(): string[][] {
  return [
    ["受注", "", "", "", "", "完了", "", "", "", ""],
    ["", "9月", "10月", "11月", "第1四半期", "", "9月", "10月", "11月", "第1四半期"],
    ["売上", "100", "110", "120", "330", "売上", "150", "160", "170", "480"],
    ["粗利", "30", "33", "36", "99", "粗利", "45", "48", "51", "144"],
    ["目標粗利", "40", "40", "40", "120", "目標粗利", "50", "50", "50", "150"],
    ["粗利達成率", "75", "82.5", "90", "82.5", "粗利達成率", "90", "96", "102", "96"],
  ];
}

function prependColumn(grid: string[][], value = ""): string[][] {
  return grid.map((row) => [value, ...row]);
}

function appendColumn(grid: string[][], value = ""): string[][] {
  return grid.map((row) => [...row, value]);
}

const expectedOrder = [
  { crId: "CR1", kind: "order", month: 9, sales: 100, grossProfit: 30, targetGrossProfit: 40, achievementRate: 75 },
  { crId: "CR1", kind: "order", month: 10, sales: 110, grossProfit: 33, targetGrossProfit: 40, achievementRate: 82.5 },
  { crId: "CR1", kind: "order", month: 11, sales: 120, grossProfit: 36, targetGrossProfit: 40, achievementRate: 90 },
];

const expectedCompleted = [
  { crId: "CR1", kind: "completed", month: 9, sales: 150, grossProfit: 45, targetGrossProfit: 50, achievementRate: 90 },
  { crId: "CR1", kind: "completed", month: 10, sales: 160, grossProfit: 48, targetGrossProfit: 50, achievementRate: 96 },
  { crId: "CR1", kind: "completed", month: 11, sales: 170, grossProfit: 51, targetGrossProfit: 50, achievementRate: 102 },
];

describe("parseCrProgressReport", () => {
  it("parses the base report with no warnings", () => {
    const result = parseCrProgressReport(buildBaseGrid(), "CR1");
    expect(result.order).toEqual(expectedOrder);
    expect(result.completed).toEqual(expectedCompleted);
    expect(result.warnings).toEqual([]);
  });

  it("distinguishes same-named labels by block (同名ラベルが複数ある場合に正しいブロックを選ぶ)", () => {
    const result = parseCrProgressReport(buildBaseGrid(), "CR1");
    // 「粗利」ラベルは受注・完了の両ブロックに存在するが、値は取り違えていない
    expect(result.order.find((r) => r.month === 9)?.grossProfit).toBe(30);
    expect(result.completed.find((r) => r.month === 9)?.grossProfit).toBe(45);
  });

  it("works with extra blank columns before and after (列の前後に空列が追加されても動く)", () => {
    let grid = buildBaseGrid();
    grid = prependColumn(prependColumn(grid));
    grid = appendColumn(appendColumn(grid));

    const result = parseCrProgressReport(grid, "CR1");
    expect(result.order).toEqual(expectedOrder);
    expect(result.completed).toEqual(expectedCompleted);
  });

  it("works with extra blank rows before and after (行の前後に空行が追加されても動く)", () => {
    const grid = buildBaseGrid();
    const blankRow = grid[0].map(() => "");
    const padded = [blankRow, blankRow, ...grid, blankRow];

    const result = parseCrProgressReport(padded, "CR1");
    expect(result.order).toEqual(expectedOrder);
    expect(result.completed).toEqual(expectedCompleted);
  });

  it("works when the gap between 受注 and 完了 changes (受注と完了の間隔が変わっても動く)", () => {
    const grid = buildBaseGrid();
    // 受注ブロックと完了ブロックの間に空列を3つ挿入する
    const widened = grid.map((row) => [...row.slice(0, 5), "", "", "", ...row.slice(5)]);

    const result = parseCrProgressReport(widened, "CR1");
    expect(result.order).toEqual(expectedOrder);
    expect(result.completed).toEqual(expectedCompleted);
  });

  it("works when the month header row shifts down (月ブロックの開始行がずれても動く)", () => {
    const grid = buildBaseGrid();
    const blockHeaderRow = grid[0];
    const monthHeaderRow = grid[1];
    const dataRows = grid.slice(2);
    const blankRow = grid[0].map(() => "");

    // ブロック見出し行と月ヘッダー行の間に空行を2つ挿入
    const shifted = [blockHeaderRow, blankRow, blankRow, monthHeaderRow, ...dataRows];

    const result = parseCrProgressReport(shifted, "CR1");
    expect(result.order).toEqual(expectedOrder);
    expect(result.completed).toEqual(expectedCompleted);
  });

  it("ignores note rows inserted anywhere (注記行が追加されても動く)", () => {
    const grid = buildBaseGrid();
    const noteRow = ["※特記事項", "一部見込み値を含む", "", "", "", "", "", "", "", ""];
    const withNote = [...grid.slice(0, 3), noteRow, ...grid.slice(3)];

    const result = parseCrProgressReport(withNote, "CR1");
    expect(result.order).toEqual(expectedOrder);
    expect(result.completed).toEqual(expectedCompleted);
  });

  it("works when quarter subtotal columns are absent (四半期集計列が存在しなくても動く)", () => {
    // 各ブロックの第1四半期列(元のcol4, col9)を削除する
    const grid = buildBaseGrid().map((row) => [...row.slice(0, 4), ...row.slice(5, 9)]);

    const result = parseCrProgressReport(grid, "CR1");
    expect(result.order).toEqual(expectedOrder);
    expect(result.completed).toEqual(expectedCompleted);
    expect(result.warnings).toEqual([]);
  });

  it("throws a clear error when a required label is missing (必須ラベルが欠けた場合は明確なエラー)", () => {
    const grid = buildBaseGrid().map((row) => row.map((cell) => (cell === "目標粗利" ? "" : cell)));

    expect(() => parseCrProgressReport(grid, "CR1")).toThrow(SheetParseError);
    expect(() => parseCrProgressReport(grid, "CR1")).toThrow(/目標粗利/);
  });

  it("throws a clear error when 受注/完了 labels are missing", () => {
    const grid = buildBaseGrid().map((row) => row.map((cell) => (cell === "完了" ? "" : cell)));

    expect(() => parseCrProgressReport(grid, "CR1")).toThrow(SheetParseError);
    expect(() => parseCrProgressReport(grid, "CR1")).toThrow(/完了/);
  });

  it("warns when the sheet's achievementRate disagrees with the recalculated value beyond tolerance", () => {
    const grid = buildBaseGrid();
    grid[5][1] = "60"; // 9月の受注達成率をシート上だけ60%に書き換える(実際は75%)

    const result = parseCrProgressReport(grid, "CR1");
    expect(result.order.find((r) => r.month === 9)?.achievementRate).toBe(75); // 再計算値を採用
    expect(result.warnings.some((w) => w.includes("粗利達成率の差異"))).toBe(true);
  });

  it("warns when the sheet's quarter subtotal disagrees with the recalculated sum", () => {
    const grid = buildBaseGrid();
    grid[3][4] = "999"; // 受注ブロックの第1四半期粗利をシート上だけ改ざん(実際は99)

    const result = parseCrProgressReport(grid, "CR1");
    expect(result.warnings.some((w) => w.includes("粗利集計の差異"))).toBe(true);
  });

  it("treats a blank cell as null (未入力), distinct from an explicit 0 (空欄は0ではなく未入力)", () => {
    const grid = buildBaseGrid();
    grid[2][2] = ""; // 受注10月の売上を空欄に
    grid[3][2] = ""; // 受注10月の粗利を空欄に
    grid[5][2] = ""; // 受注10月の達成率も空欄に（検算対象から外れる）

    const result = parseCrProgressReport(grid, "CR1");
    const october = result.order.find((r) => r.month === 10);

    expect(october?.sales).toBeNull();
    expect(october?.grossProfit).toBeNull();
    expect(october?.achievementRate).toBeNull();
    // 目標粗利はシート上に値があるので未入力にはならない
    expect(october?.targetGrossProfit).toBe(40);
    // 他の月は影響を受けない
    expect(result.order.find((r) => r.month === 9)?.grossProfit).toBe(30);
  });

  it("keeps an explicit 0 as a real recorded value, not null", () => {
    const grid = buildBaseGrid();
    grid[2][2] = "0"; // 受注10月の売上を実績0円に
    grid[3][2] = "0"; // 受注10月の粗利を実績0円に

    const result = parseCrProgressReport(grid, "CR1");
    const october = result.order.find((r) => r.month === 10);

    expect(october?.sales).toBe(0);
    expect(october?.grossProfit).toBe(0);
    expect(october?.achievementRate).toBe(0); // 0 ÷ 40 × 100 = 0(未入力のnullとは異なる)
  });

  it("skips the quarter cross-check when every month in range is blank", () => {
    const grid = buildBaseGrid();
    // 受注ブロックの9〜11月をすべて空欄にする（第1四半期は99のまま=シート側の値と齟齬）
    for (const col of [1, 2, 3]) {
      grid[2][col] = "";
      grid[3][col] = "";
    }

    const result = parseCrProgressReport(grid, "CR1");
    expect(result.order.every((r) => r.grossProfit === null)).toBe(true);
    expect(result.warnings.some((w) => w.includes("粗利集計の差異"))).toBe(false);
  });
});
