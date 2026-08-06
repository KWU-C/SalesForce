/**
 * 実シート構造の調査用診断スクリプト。
 *
 *   npm run inspect:sheets
 *
 * まずスプレッドシート内の全シート名一覧を表示し、続けて対象シート
 * （CR1〜CR3・全社推移、環境変数が設定されているもののみ）を取得して
 * ラベルの検出位置とReportRegistryによる帳票判定・解析結果
 * （成功/失敗、警告）を表示する。
 *
 * 認証は Application Default Credentials（ローカルはサービスアカウント偽装、
 * 本番はCloud Runにアタッチされたサービスアカウント）に委ねる。このスクリプト
 * 自身は認証情報を一切扱わない（services/google-sheets/sheetsClient.ts参照）。
 *
 * 重要: 実データの金額・数量など数値セルの中身は一切ログに出力しない。
 * Google Sheets API自体から返るエラー（接続失敗・権限不足等）も、内容を
 * そのまま出さず固定カテゴリに分類してから表示する
 * （repositories/salesDataSourceError.ts）。表示するのはラベル文字列
 * （このスクリプト自身が知っている固定の探索対象文言）とそのセル位置・件数、
 * およびエラーカテゴリのみ。
 *
 * このスクリプトはコード上は実装済みだが、スプレッドシートID等の環境変数が
 * 未設定のため、現時点ではまだ実行していない（docs/sheet-mapping.md参照）。
 */

import { getCompanyReportSheetRef, getCrReportSheetRef } from "../src/config/googleSheets";
import type { SheetRef } from "../src/config/googleSheets";
import { monthLabel, REPORT_LABELS } from "../src/repositories/parsers/reportLabels";
import {
  findCellsInRegion,
  fullRegion,
  maxColumnIndex,
  SheetParseError,
  type CellPosition,
} from "../src/repositories/parsers/sheetGrid";
import { createDefaultReportRegistry } from "../src/repositories/reportDefinitions";
import type { ReportRegistry } from "../src/repositories/reportRegistry";
import { classifySheetsError } from "../src/repositories/salesDataSourceError";
import { GoogleApiSheetsValuesReader } from "../src/services/google-sheets/sheetsClient";
import type { CrId } from "../src/domain/types";

/**
 * エラー内容を安全に要約する。
 * - 自前で投げた既知のエラー（環境変数未設定、ラベル探索失敗）はそのまま表示してよい
 *   （中身は固定文言・ラベル名・件数のみで、実データや認証情報を含まない）
 * - Google Sheets API自体が投げたエラー（接続失敗・権限不足等、内容を制御できない）は
 *   固定カテゴリに分類してから表示する（生のメッセージは出さない）
 */
function safeErrorSummary(error: unknown): string {
  if (error instanceof SheetParseError) return error.message;
  if (error instanceof Error && /^環境変数/.test(error.message)) return error.message;
  return `category=${classifySheetsError(error)}`;
}

function toColumnLetter(index: number): string {
  let n = index;
  let label = "";
  do {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
}

function formatPositions(positions: CellPosition[]): string {
  if (positions.length === 0) return "見つかりません";
  return positions.map((p) => `${toColumnLetter(p.col)}${p.row + 1}`).join(", ");
}

function reportLabelPositions(grid: string[][]): void {
  const region = fullRegion(grid);
  const labels = [
    REPORT_LABELS.order,
    REPORT_LABELS.completed,
    REPORT_LABELS.sales,
    REPORT_LABELS.grossProfit,
    REPORT_LABELS.targetGrossProfit,
    REPORT_LABELS.achievementRate,
    ...Array.from({ length: 12 }, (_, i) => monthLabel(i + 1)),
  ];

  for (const label of labels) {
    const positions = findCellsInRegion(grid, label, region);
    console.log(`  「${label}」: ${formatPositions(positions)}`);
  }
}

async function inspectSheet(
  registry: ReportRegistry,
  reader: GoogleApiSheetsValuesReader,
  label: string,
  ref: SheetRef,
  crId: CrId
): Promise<void> {
  console.log(`\n=== ${label}（シート: ${ref.sheetName}） ===`);

  let grid: string[][];
  try {
    grid = await reader.getValues(ref.spreadsheetId, ref.sheetName);
  } catch (error) {
    console.log(`  → 接続: 失敗 - ${safeErrorSummary(error)}`);
    return;
  }
  console.log("  → 接続: 成功");
  console.log(`行数: ${grid.length} / 列数: ${maxColumnIndex(grid) + 1}`);

  reportLabelPositions(grid);

  try {
    const reportName = registry.identify(grid);
    console.log(`  → Registry判定: 「${reportName}」`);
  } catch (error) {
    console.log(`  → Registry判定: 失敗 - ${safeErrorSummary(error)}`);
    return;
  }

  try {
    const result = registry.parse(grid, { crId });
    console.log(
      `  → 解析結果: 受注${result.order?.length ?? "なし"}行 / 完了${result.completed?.length ?? "なし"}行`
    );
    if (result.warnings.length > 0) {
      console.log("  → 警告:");
      result.warnings.forEach((w) => console.log(`     - ${w}`));
    }
  } catch (error) {
    console.log(`  → 解析: 失敗 - ${safeErrorSummary(error)}`);
  }
}

function requireSpreadsheetId(): string {
  const id = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  if (!id) {
    throw new Error(
      "環境変数 GOOGLE_SHEETS_SPREADSHEET_ID が未設定です。docs/sheet-mapping.md を参照し設定してください。"
    );
  }
  return id;
}

/**
 * CR1〜CR3・全社推移のシート名がまだ環境変数に設定されていなくても、
 * スプレッドシートID（GOOGLE_SHEETS_SPREADSHEET_ID）さえ分かれば
 * 全シート（タブ）名の一覧を確認できる。
 */
async function listAllSheetNames(reader: GoogleApiSheetsValuesReader): Promise<void> {
  console.log("=== スプレッドシート内のシート名一覧 ===");
  const spreadsheetId = requireSpreadsheetId();

  let names: string[];
  try {
    names = await reader.listSheetNames(spreadsheetId);
  } catch (error) {
    console.log(`  → 接続: 失敗 - ${safeErrorSummary(error)}`);
    return;
  }
  console.log("  → 接続: 成功");

  if (names.length === 0) {
    console.log("  シートが見つかりませんでした（アクセス権限をご確認ください）");
    return;
  }
  names.forEach((name) => console.log(`  - ${name}`));
}

async function main(): Promise<void> {
  const reader = new GoogleApiSheetsValuesReader();
  const registry = createDefaultReportRegistry();
  const crIds: ("CR1" | "CR2" | "CR3")[] = ["CR1", "CR2", "CR3"];

  try {
    await listAllSheetNames(reader);
  } catch (error) {
    console.log(`  スキップ: ${safeErrorSummary(error)}`);
  }

  for (const crId of crIds) {
    try {
      await inspectSheet(registry, reader, crId, getCrReportSheetRef(crId), crId);
    } catch (error) {
      console.log(`\n=== ${crId} ===\n  スキップ: ${safeErrorSummary(error)}`);
    }
  }

  try {
    await inspectSheet(registry, reader, "全社推移", getCompanyReportSheetRef(), "ALL");
  } catch (error) {
    console.log(`\n=== 全社推移 ===\n  スキップ: ${safeErrorSummary(error)}`);
  }
}

main().catch((error) => {
  console.error(safeErrorSummary(error));
  process.exit(1);
});
