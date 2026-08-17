import { GoogleApiSheetsValuesReader } from "@/services/google-sheets/sheetsClient";
import { GoogleSheetsSalesProgressDataSource } from "./googleSheetsSalesProgressDataSource";
import { MockSalesProgressDataSource } from "./mockSalesProgressDataSource";
import { SalesforceSalesProgressDataSource } from "./salesforceSalesProgressDataSource";
import type { SalesProgressDataSource } from "./salesProgressDataSource";

/**
 * データ取得元の切り替えポイント（唯一ここだけ）。
 * SALES_DATA_SOURCE=mock（デフォルト）| salesforce | google-sheets で切り替える。
 * UI層・page.tsxはこの関数の戻り値の型（SalesProgressDataSource）だけに依存し、
 * 取得元を意識しない。
 *
 * salesforceが本番の正データ（実績=Process__c、目標=SalesTarget__c）。
 * google-sheetsは実装済みだが、本番データパスとしては使わない
 * （検証・比較用として位置づけを変更済み、docs/salesforce-integration-design.md 7節）。
 *
 * 重要: 取得に失敗してもMockには自動フォールバックしない（本番で誤った数値を
 * 表示する危険があるため、ユーザー明示指示）。呼び出し側（app/page.tsx）は
 * 各DataSourceが投げるSalesDataSourceErrorを捕捉し、汎用エラー画面を表示する。
 */
export function getSalesProgressDataSource(): SalesProgressDataSource {
  const source = process.env.SALES_DATA_SOURCE ?? "mock";

  switch (source) {
    case "mock":
      return new MockSalesProgressDataSource();
    case "salesforce":
      return new SalesforceSalesProgressDataSource();
    case "google-sheets":
      return new GoogleSheetsSalesProgressDataSource(new GoogleApiSheetsValuesReader());
    default:
      throw new Error(`Unknown SALES_DATA_SOURCE: "${source}"`);
  }
}

/** 画面表示用の取得元ラベル（現在有効な SALES_DATA_SOURCE に対応するもの） */
export function getActiveSalesDataSourceLabel(): string {
  const source = process.env.SALES_DATA_SOURCE ?? "mock";
  if (source === "salesforce") return "Salesforce";
  if (source === "google-sheets") return "Google Sheets";
  return "モックデータ";
}
