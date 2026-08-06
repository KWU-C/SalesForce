import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SheetsValuesReader } from "@/services/google-sheets/sheetsClient";
import { GoogleSheetsSalesProgressDataSource } from "./googleSheetsSalesProgressDataSource";

/**
 * 認証クライアント（GoogleApiSheetsValuesReader）そのものはモックしない。
 * SheetsValuesReaderインターフェースを実装したフェイクを注入することで、
 * 実際のGoogle Sheets API・認証情報を一切必要とせずにDataSourceの
 * 組み立てロジック（Registryへの委譲、全社合算、エラー分類・ログ）を検証する。
 */
function buildCrReportGrid(salesBase: number): string[][] {
  return [
    ["受注", "", "", "完了", "", ""],
    ["", "9月", "10月", "", "9月", "10月"],
    ["売上", String(salesBase), String(salesBase + 10), "売上", String(salesBase + 20), String(salesBase + 30)],
    ["粗利", "30", "33", "粗利", "45", "48"],
    ["目標粗利", "40", "40", "目標粗利", "50", "50"],
  ];
}

class FakeSheetsValuesReader implements SheetsValuesReader {
  constructor(private readonly gridsBySheetName: Record<string, string[][] | Error>) {}

  async getValues(_spreadsheetId: string, sheetName: string): Promise<string[][]> {
    const grid = this.gridsBySheetName[sheetName];
    if (grid === undefined) throw new Error(`no fixture for sheet "${sheetName}"`);
    if (grid instanceof Error) throw grid;
    return grid;
  }
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.GOOGLE_SHEETS_SPREADSHEET_ID = "test-spreadsheet-id";
  process.env.GOOGLE_SHEETS_CR1_SHEET_NAME = "CR1シート";
  process.env.GOOGLE_SHEETS_CR2_SHEET_NAME = "CR2シート";
  process.env.GOOGLE_SHEETS_CR3_SHEET_NAME = "CR3シート";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe("GoogleSheetsSalesProgressDataSource", () => {
  it("fetches each CR sheet via the injected reader and aggregates ALL from them", async () => {
    const reader = new FakeSheetsValuesReader({
      CR1シート: buildCrReportGrid(100),
      CR2シート: buildCrReportGrid(200),
      CR3シート: buildCrReportGrid(300),
    });
    const dataSource = new GoogleSheetsSalesProgressDataSource(reader);

    const result = await dataSource.getCrProgress();

    const cr1 = result.find((p) => p.crId === "CR1");
    const all = result.find((p) => p.crId === "ALL");

    expect(cr1?.order.find((r) => r.month === 9)?.sales).toBe(100);
    // ALL = CR1(100) + CR2(200) + CR3(300)の9月受注売上合算
    expect(all?.order.find((r) => r.month === 9)?.sales).toBe(600);
  });

  it("throws a sanitized SalesDataSourceError (not the raw API error) when a sheet fetch fails", async () => {
    const authError = Object.assign(new Error("permission denied"), {
      response: { status: 403 },
    });
    const reader = new FakeSheetsValuesReader({
      CR1シート: authError,
      CR2シート: buildCrReportGrid(200),
      CR3シート: buildCrReportGrid(300),
    });
    const dataSource = new GoogleSheetsSalesProgressDataSource(reader);

    await expect(dataSource.getCrProgress()).rejects.toMatchObject({
      name: "SalesDataSourceError",
      category: "AUTH_ERROR",
    });
  });

  it("logs only the sheet name and error category on failure, never the raw error message", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const authError = Object.assign(new Error("this must not appear in logs: secret-token-xyz"), {
      response: { status: 403 },
    });
    const reader = new FakeSheetsValuesReader({
      CR1シート: authError,
      CR2シート: buildCrReportGrid(200),
      CR3シート: buildCrReportGrid(300),
    });
    const dataSource = new GoogleSheetsSalesProgressDataSource(reader);

    await expect(dataSource.getCrProgress()).rejects.toThrow();

    const loggedMessages = errorSpy.mock.calls.map((call) => call.join(" "));
    expect(loggedMessages.some((m) => m.includes("sheet=CR1シート") && m.includes("category=AUTH_ERROR"))).toBe(
      true
    );
    expect(loggedMessages.some((m) => m.includes("secret-token-xyz"))).toBe(false);
  });
});
