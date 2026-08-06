/**
 * Google Sheets連携の設定。
 *
 * セル座標はハードコードしない。シート名・スプレッドシートIDも環境変数から
 * 解決する（値そのものはコードに書かない）。
 *
 * 実際のシートは「●CR別_月次営業まとめ」のような帳票形式（受注/完了が
 * 左右のブロックに分かれ、月が横方向に並ぶ）であり、CR1〜CR3それぞれ
 * 1シートに受注・完了の両方が含まれる（受注表・完了表が別シートではない）。
 * 解析は repositories/parsers/crProgressReportParser.ts が行う
 * （ラベル探索方式。docs/sheet-mapping.md参照）。
 *
 * 正規化されたテーブル形式（1行目がヘッダー行）のシートを使う場合のために
 * GOOGLE_SHEETS_HEADER_NAMES と parseNormalizedTable() も残しているが、
 * 現状どのDataSourceからも使用していない。
 */

/** 正規化テーブル形式（normalizedTableParser）用。実際のシートの文言に合わせて調整すること */
export const GOOGLE_SHEETS_HEADER_NAMES = {
  month: "月",
  sales: "売上",
  grossProfit: "粗利",
  targetGrossProfit: "目標粗利",
  achievementRate: "粗利達成率",
} as const;

export interface SheetRef {
  spreadsheetId: string;
  sheetName: string;
}

type ConcreteCrId = "CR1" | "CR2" | "CR3";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `環境変数 ${name} が未設定です。docs/sheet-mapping.md を参照し設定してください。`
    );
  }
  return value;
}

/** CR別・月次営業まとめシートの参照（受注・完了の両ブロックを含む1シート） */
export function getCrReportSheetRef(crId: ConcreteCrId): SheetRef {
  return {
    spreadsheetId: requireEnv("GOOGLE_SHEETS_SPREADSHEET_ID"),
    sheetName: requireEnv(`GOOGLE_SHEETS_${crId}_SHEET_NAME`),
  };
}

/** 全社推移シートの参照（初期フェーズではCR1〜3合算を使うため未接続、将来用） */
export function getCompanyReportSheetRef(): SheetRef {
  return {
    spreadsheetId: requireEnv("GOOGLE_SHEETS_SPREADSHEET_ID"),
    sheetName: requireEnv("GOOGLE_SHEETS_COMPANY_SHEET_NAME"),
  };
}
