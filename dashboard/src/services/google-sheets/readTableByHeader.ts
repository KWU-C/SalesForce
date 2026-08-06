/**
 * セル座標に依存せず、取得したテーブルの1行目をヘッダー行として
 * 列名で値を引くための汎用ユーティリティ。
 *
 * 列の追加・移動・並べ替えがあっても、ヘッダー文言さえ一致していれば
 * 正しく値を取り出せる（列インデックスをコードにハードコードしない）。
 */
export function indexRowsByHeader(rows: string[][]): Record<string, string>[] {
  if (rows.length === 0) return [];

  const [headerRow, ...dataRows] = rows;
  const columnIndexByHeader = new Map<string, number>();
  headerRow.forEach((rawHeader, columnIndex) => {
    const header = rawHeader?.trim();
    if (header && !columnIndexByHeader.has(header)) {
      columnIndexByHeader.set(header, columnIndex);
    }
  });

  return dataRows
    .filter((row) => row.some((cell) => cell !== undefined && cell !== ""))
    .map((row) => {
      const record: Record<string, string> = {};
      for (const [header, columnIndex] of columnIndexByHeader) {
        record[header] = row[columnIndex] ?? "";
      }
      return record;
    });
}
