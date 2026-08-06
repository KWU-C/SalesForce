/**
 * 帳票形式（セル座標非依存・ラベル探索方式）のGoogle Sheets Parserが共通で使う
 * グリッド操作のプリミティブ。
 *
 * セル座標（A3、C5等）は一切ハードコードしない。ラベル文字列をグリッド全体
 * または指定領域から探索し、見つかった相対位置を基準に値を取得する。
 */

export interface CellPosition {
  row: number;
  col: number;
}

export interface CellRegion {
  rowStart: number;
  rowEnd: number; // inclusive
  colStart: number;
  colEnd: number; // inclusive
}

/** ラベルが見つからない・複数見つかって一意に定まらない場合に投げる */
export class SheetParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SheetParseError";
  }
}

export function maxColumnIndex(grid: string[][]): number {
  return grid.reduce((max, row) => Math.max(max, row.length - 1), 0);
}

export function fullRegion(grid: string[][]): CellRegion {
  return {
    rowStart: 0,
    rowEnd: Math.max(grid.length - 1, 0),
    colStart: 0,
    colEnd: maxColumnIndex(grid),
  };
}

export function cellAt(grid: string[][], row: number, col: number): string | undefined {
  return grid[row]?.[col];
}

function normalize(raw: string | undefined): string {
  return raw?.trim() ?? "";
}

/** 指定領域内でラベル文字列（完全一致・前後空白は無視）に一致するセルの位置を全て返す */
export function findCellsInRegion(
  grid: string[][],
  label: string,
  region: CellRegion
): CellPosition[] {
  const matches: CellPosition[] = [];
  const rowEnd = Math.min(region.rowEnd, grid.length - 1);

  for (let row = Math.max(region.rowStart, 0); row <= rowEnd; row += 1) {
    const gridRow = grid[row] ?? [];
    const colEnd = Math.min(region.colEnd, gridRow.length - 1);
    for (let col = Math.max(region.colStart, 0); col <= colEnd; col += 1) {
      if (normalize(gridRow[col]) === label) {
        matches.push({ row, col });
      }
    }
  }

  return matches;
}

/**
 * 指定領域内でラベルがちょうど1つだけ見つかることを要求する。
 * 0件・2件以上の場合は、どのラベルが・どこで問題になったか分かる形でエラーにする。
 */
export function findSingleCell(
  grid: string[][],
  label: string,
  region: CellRegion,
  context: string
): CellPosition {
  const matches = findCellsInRegion(grid, label, region);

  if (matches.length === 0) {
    throw new SheetParseError(`ラベル「${label}」が${context}内に見つかりません`);
  }
  if (matches.length > 1) {
    throw new SheetParseError(
      `ラベル「${label}」が${context}内に${matches.length}件見つかりました（一意に特定できません）`
    );
  }

  return matches[0];
}

export function withColumnRange(
  region: CellRegion,
  colStart: number,
  colEnd: number
): CellRegion {
  return { ...region, colStart, colEnd };
}
