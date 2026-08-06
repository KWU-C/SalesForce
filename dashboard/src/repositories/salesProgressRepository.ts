import { GoogleApiSheetsValuesReader } from "@/services/google-sheets/sheetsClient";
import { GoogleSheetsSalesProgressDataSource } from "./googleSheetsSalesProgressDataSource";
import { MockSalesProgressDataSource } from "./mockSalesProgressDataSource";
import type { SalesProgressDataSource } from "./salesProgressDataSource";

/**
 * データ取得元の切り替えポイント（唯一ここだけ）。
 * SALES_DATA_SOURCE=mock（デフォルト）| google-sheets で切り替える。
 * UI層・page.tsxはこの関数の戻り値の型（SalesProgressDataSource）だけに依存し、
 * 取得元がモックかGoogle Sheetsかを意識しない。
 *
 * google-sheetsは実装済みだが、スプレッドシートID・シート名・ヘッダー文言は
 * まだ未確認のプレースホルダーのため（docs/sheet-mapping.md参照）、
 * ユーザー確認が取れるまで本番では選択しない。
 *
 * 重要: ここでSALES_DATA_SOURCE=google-sheetsが指定された場合、取得に失敗しても
 * Mockには自動フォールバックしない（本番で誤った数値を表示する危険があるため、
 * ユーザー明示指示）。呼び出し側（app/page.tsx）はGoogleSheetsSalesProgressDataSource
 * が投げるSalesDataSourceErrorを捕捉し、汎用エラー画面を表示する。
 */
export function getSalesProgressDataSource(): SalesProgressDataSource {
  const source = process.env.SALES_DATA_SOURCE ?? "mock";

  switch (source) {
    case "mock":
      return new MockSalesProgressDataSource();
    case "google-sheets":
      return new GoogleSheetsSalesProgressDataSource(new GoogleApiSheetsValuesReader());
    default:
      throw new Error(`Unknown SALES_DATA_SOURCE: "${source}"`);
  }
}

/** 画面表示用の取得元ラベル（現在有効な SALES_DATA_SOURCE に対応するもの） */
export function getActiveSalesDataSourceLabel(): string {
  const source = process.env.SALES_DATA_SOURCE ?? "mock";
  return source === "google-sheets" ? "Google Sheets" : "モックデータ";
}
