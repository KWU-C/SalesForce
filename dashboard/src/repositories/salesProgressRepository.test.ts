import { afterEach, describe, expect, it } from "vitest";
import { GoogleSheetsSalesProgressDataSource } from "./googleSheetsSalesProgressDataSource";
import { MockSalesProgressDataSource } from "./mockSalesProgressDataSource";
import { getActiveSalesDataSourceLabel, getSalesProgressDataSource } from "./salesProgressRepository";

const ORIGINAL_ENV = process.env.SALES_DATA_SOURCE;

afterEach(() => {
  if (ORIGINAL_ENV === undefined) {
    delete process.env.SALES_DATA_SOURCE;
  } else {
    process.env.SALES_DATA_SOURCE = ORIGINAL_ENV;
  }
});

describe("getSalesProgressDataSource", () => {
  it("defaults to Mock when SALES_DATA_SOURCE is unset", () => {
    delete process.env.SALES_DATA_SOURCE;
    expect(getSalesProgressDataSource()).toBeInstanceOf(MockSalesProgressDataSource);
  });

  it("selects Google Sheets when SALES_DATA_SOURCE=google-sheets, with no fallback to Mock", () => {
    process.env.SALES_DATA_SOURCE = "google-sheets";
    // Google Sheetsが選ばれた場合、環境変数や接続情報が無くても
    // (＝コンストラクタ自体はここでは例外を投げない) Mockには一切スイッチしない。
    // 実際の取得失敗時の挙動はgoogleSheetsSalesProgressDataSource.test.ts等が
    // 別途保証する（SalesDataSourceErrorを投げるのみで、内部でMockへは切り替えない）。
    expect(getSalesProgressDataSource()).toBeInstanceOf(GoogleSheetsSalesProgressDataSource);
  });

  it("throws (does not silently fall back to Mock) for an unknown SALES_DATA_SOURCE value", () => {
    process.env.SALES_DATA_SOURCE = "something-else";
    expect(() => getSalesProgressDataSource()).toThrow(/Unknown SALES_DATA_SOURCE/);
  });
});

describe("getActiveSalesDataSourceLabel", () => {
  it("reflects the configured source without inferring success/failure", () => {
    delete process.env.SALES_DATA_SOURCE;
    expect(getActiveSalesDataSourceLabel()).toBe("モックデータ");

    process.env.SALES_DATA_SOURCE = "google-sheets";
    expect(getActiveSalesDataSourceLabel()).toBe("Google Sheets");
  });
});
