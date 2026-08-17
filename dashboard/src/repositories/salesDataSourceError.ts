import { SheetParseError } from "./parsers/sheetGrid";
import { SalesforceAuthError, SalesforceQueryError } from "@/services/salesforce/salesforceClient";

/**
 * データ取得エラーの分類。UI・ログの両方でこの固定カテゴリのみを扱い、
 * 元の例外メッセージ（金額・認証情報等を含みうる）を画面やログに露出させない。
 */
export type SalesDataSourceErrorCategory =
  | "AUTH_ERROR" // 権限不足（401/403）
  | "NOT_FOUND" // 対象シートなし（404）
  | "NETWORK_ERROR" // Sheets API接続失敗
  | "PARSE_ERROR" // 必須ラベル不足・帳票判定不能（SheetParseError）
  | "CONFIG_ERROR" // 環境変数未設定（スプレッドシートID・シート名）
  | "UNKNOWN_ERROR";

/**
 * データ取得元（Google Sheets等）で発生したエラーを表す。
 * message には固定文言のみを含め、原因となった例外の詳細（金額・認証情報・
 * アクセストークン等を含みうる）は運ばない。
 */
export class SalesDataSourceError extends Error {
  readonly category: SalesDataSourceErrorCategory;
  /** ログ・診断用のシート識別子（シート名、解決前はCR名などのフォールバック） */
  readonly sheetLabel: string;

  constructor(category: SalesDataSourceErrorCategory, sheetLabel: string) {
    super(`sales data source error: ${category}`);
    this.name = "SalesDataSourceError";
    this.category = category;
    this.sheetLabel = sheetLabel;
  }
}

function hasResponseStatus(error: unknown): error is { response: { status: number } } {
  if (typeof error !== "object" || error === null || !("response" in error)) return false;
  const response = (error as { response?: unknown }).response;
  if (typeof response !== "object" || response === null || !("status" in response)) return false;
  return typeof (response as { status?: unknown }).status === "number";
}

/**
 * 例外を固定カテゴリへ分類する。ここで初めて元の例外の中身（message等）を見るが、
 * 戻り値はカテゴリ名のみ＝呼び出し側にメッセージの詳細が漏れることはない。
 */
export function classifySheetsError(error: unknown): SalesDataSourceErrorCategory {
  if (error instanceof SheetParseError) return "PARSE_ERROR";

  if (hasResponseStatus(error)) {
    const status = error.response.status;
    if (status === 401 || status === 403) return "AUTH_ERROR";
    if (status === 404) return "NOT_FOUND";
  }

  if (error instanceof Error) {
    if (/環境変数/.test(error.message)) return "CONFIG_ERROR";
    if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|network/i.test(error.message)) {
      return "NETWORK_ERROR";
    }
  }

  return "UNKNOWN_ERROR";
}

/** SalesforceSalesProgressDataSource用の分類（classifySheetsErrorと同じ固定カテゴリを使う） */
export function classifySalesforceError(error: unknown): SalesDataSourceErrorCategory {
  if (error instanceof SalesforceAuthError) return "AUTH_ERROR";

  if (error instanceof SalesforceQueryError) {
    if (error.status === 401 || error.status === 403) return "AUTH_ERROR";
    if (error.status === 404) return "NOT_FOUND";
    return "UNKNOWN_ERROR";
  }

  if (error instanceof Error) {
    if (/環境変数/.test(error.message)) return "CONFIG_ERROR";
    if (/SalesTarget__cに.+のレコードがありません/.test(error.message)) return "NOT_FOUND";
    if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|fetch failed/i.test(error.message)) {
      return "NETWORK_ERROR";
    }
  }

  return "UNKNOWN_ERROR";
}
