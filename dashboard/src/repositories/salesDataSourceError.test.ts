import { describe, expect, it } from "vitest";
import { classifySheetsError, SalesDataSourceError } from "./salesDataSourceError";
import { SheetParseError } from "./parsers/sheetGrid";

describe("classifySheetsError", () => {
  it("classifies SheetParseError (必須ラベル不足・帳票判定不能) as PARSE_ERROR", () => {
    expect(classifySheetsError(new SheetParseError("ラベルが見つかりません"))).toBe("PARSE_ERROR");
  });

  it("classifies a 403 response as AUTH_ERROR (権限不足)", () => {
    expect(classifySheetsError({ response: { status: 403 } })).toBe("AUTH_ERROR");
  });

  it("classifies a 401 response as AUTH_ERROR", () => {
    expect(classifySheetsError({ response: { status: 401 } })).toBe("AUTH_ERROR");
  });

  it("classifies a 404 response as NOT_FOUND (対象シートなし)", () => {
    expect(classifySheetsError({ response: { status: 404 } })).toBe("NOT_FOUND");
  });

  it("classifies a missing env var error as CONFIG_ERROR", () => {
    expect(classifySheetsError(new Error("環境変数 GOOGLE_SHEETS_SPREADSHEET_ID が未設定です"))).toBe(
      "CONFIG_ERROR"
    );
  });

  it("classifies a network-ish error as NETWORK_ERROR (接続失敗)", () => {
    expect(classifySheetsError(new Error("getaddrinfo ENOTFOUND sheets.googleapis.com"))).toBe(
      "NETWORK_ERROR"
    );
  });

  it("falls back to UNKNOWN_ERROR for anything unrecognized", () => {
    expect(classifySheetsError(new Error("何か予期しないエラー"))).toBe("UNKNOWN_ERROR");
    expect(classifySheetsError("a plain string")).toBe("UNKNOWN_ERROR");
    expect(classifySheetsError(null)).toBe("UNKNOWN_ERROR");
  });
});

describe("SalesDataSourceError", () => {
  it("never includes the sheet label or category details in a way that leaks arbitrary data", () => {
    const error = new SalesDataSourceError("AUTH_ERROR", "CR1受注表");
    // messageは固定カテゴリのみを含む文言であること（元例外の内容を運ばない）
    expect(error.message).toBe("sales data source error: AUTH_ERROR");
    expect(error.category).toBe("AUTH_ERROR");
    expect(error.sheetLabel).toBe("CR1受注表");
  });
});
