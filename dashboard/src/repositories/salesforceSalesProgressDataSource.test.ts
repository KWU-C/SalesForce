import { afterEach, describe, expect, it, vi } from "vitest";
import type { SalesforceQueryClient } from "@/services/salesforce/salesforceClient";
import { SalesforceQueryError } from "@/services/salesforce/salesforceClient";
import { SalesforceSalesProgressDataSource } from "./salesforceSalesProgressDataSource";

/**
 * 認証クライアント（SalesforceClient）そのものはモックしない。
 * SalesforceQueryClientインターフェースを実装したフェイクを注入することで、
 * 実際のJWT署名・Salesforce API・認証情報を一切必要とせずにDataSourceの
 * 組み立てロジック（クエリの振り分け、目標の按分、全社合算、エラー分類・ログ）を検証する。
 */
class FakeSalesforceQueryClient implements SalesforceQueryClient {
  constructor(
    private readonly responses: {
      order: unknown[];
      completed: unknown[];
      target: unknown[] | Error;
      orderClients?: unknown[];
      completedClients?: unknown[];
    }
  ) {}

  async query<T>(soql: string): Promise<T[]> {
    if (this.responses.target instanceof Error) throw this.responses.target;
    if (soql.includes("SalesTarget__c")) return this.responses.target as T[];
    // クライアントランキングクエリ(clientName__c選択、GROUP BY無し)は月別集計との判別が必要
    if (soql.includes("clientName__c")) {
      if (soql.includes("juchuubi__c")) return (this.responses.orderClients ?? []) as T[];
      if (soql.includes("seikyuubi__c")) return (this.responses.completedClients ?? []) as T[];
    }
    if (soql.includes("juchuubi__c")) return this.responses.order as T[];
    if (soql.includes("seikyuubi__c")) return this.responses.completed as T[];
    throw new Error(`unexpected SOQL in test fake: ${soql}`);
  }
}

const TARGET_ROW = [{ TargetSales__c: 640_000_000, TargetGrossProfit__c: 540_000_000 }];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SalesforceSalesProgressDataSource", () => {
  it("routes order/completed queries correctly and aggregates ALL across CR1-3", async () => {
    const client = new FakeSalesforceQueryClient({
      order: [
        { crId: "CR1", mo: 9, sales: 20_000_000, grossProfit: 6_000_000 },
        { crId: "CR2", mo: 9, sales: 10_000_000, grossProfit: 3_000_000 },
      ],
      completed: [{ crId: "CR1", mo: 9, sales: 15_000_000, grossProfit: 5_000_000 }],
      target: TARGET_ROW,
    });
    const dataSource = new SalesforceSalesProgressDataSource(client);

    const result = await dataSource.getCrProgress();

    const cr1 = result.find((p) => p.crId === "CR1");
    const all = result.find((p) => p.crId === "ALL");

    expect(cr1?.order.find((r) => r.month === 9)?.sales).toBe(20_000_000);
    expect(cr1?.completed.find((r) => r.month === 9)?.sales).toBe(15_000_000);
    // ALL(受注,9月) = CR1(20,000,000) + CR2(10,000,000) + CR3(未入力→無視)
    expect(all?.order.find((r) => r.month === 9)?.sales).toBe(30_000_000);
  });

  it("splits the company-wide annual target evenly across the 3 CRs", async () => {
    const client = new FakeSalesforceQueryClient({ order: [], completed: [], target: TARGET_ROW });
    const dataSource = new SalesforceSalesProgressDataSource(client);

    const result = await dataSource.getCrProgress();
    const cr1 = result.find((p) => p.crId === "CR1");

    // 540,000,000 / 3 CR / 12ヶ月 = 15,000,000
    expect(cr1?.order[0]?.targetGrossProfit).toBeCloseTo(15_000_000, 5);
  });

  it("throws a sanitized SalesDataSourceError when SalesTarget__c has no record for the current term", async () => {
    const client = new FakeSalesforceQueryClient({ order: [], completed: [], target: [] });
    const dataSource = new SalesforceSalesProgressDataSource(client);

    await expect(dataSource.getCrProgress()).rejects.toMatchObject({
      name: "SalesDataSourceError",
      category: "NOT_FOUND",
    });
  });

  it("builds top-client rankings per CR from clientName__c detail rows and re-aggregates for ALL", async () => {
    // クライアントランキングクエリは非集計(列エイリアス不可)なので、フェイクの
    // レスポンスもフィールドAPI名そのまま(実際のSalesforceレスポンスの形)にする
    const client = new FakeSalesforceQueryClient({
      order: [],
      completed: [],
      target: TARGET_ROW,
      orderClients: [
        { bumonna__c: "CR1", clientName__c: "株式会社サンプル", arari__c: 5_000_000 },
        { bumonna__c: "CR1", clientName__c: "テスト商事", arari__c: 1_000_000 },
      ],
      completedClients: [{ bumonna__c: "CR2", clientName__c: "デモ工業", arari__c: 2_000_000 }],
    });
    const dataSource = new SalesforceSalesProgressDataSource(client);

    const result = await dataSource.getCrProgress();
    const cr1 = result.find((p) => p.crId === "CR1")!;
    const all = result.find((p) => p.crId === "ALL")!;

    expect(cr1.topOrderClients.map((c) => c.clientName)).toEqual(["株式会社サンプル", "テスト商事"]);
    // 新規判定は現状Salesforce側で取得できないため常にfalse(2026-08-24時点)
    expect(cr1.topOrderClients.every((c) => c.isNewThisTerm === false)).toBe(true);

    // ALLはCR1〜3横断で再集計されるため、CR2の完了ランキングもここに含まれる
    expect(all.topCompletedClients.map((c) => c.clientName)).toEqual(["デモ工業"]);
  });

  it("classifies a 401/403 query error as AUTH_ERROR and never logs the raw message", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const client = new FakeSalesforceQueryClient({
      order: [],
      completed: [],
      target: new SalesforceQueryError("this must not appear in logs: secret-token-xyz", 403),
    });
    const dataSource = new SalesforceSalesProgressDataSource(client);

    await expect(dataSource.getCrProgress()).rejects.toMatchObject({
      name: "SalesDataSourceError",
      category: "AUTH_ERROR",
    });

    const loggedMessages = errorSpy.mock.calls.map((call) => call.join(" "));
    expect(loggedMessages.some((m) => m.includes("category=AUTH_ERROR"))).toBe(true);
    expect(loggedMessages.some((m) => m.includes("secret-token-xyz"))).toBe(false);
  });
});
