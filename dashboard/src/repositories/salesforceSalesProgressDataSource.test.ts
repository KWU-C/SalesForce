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
      accounts?: unknown[];
    }
  ) {}

  async query<T>(soql: string): Promise<T[]> {
    if (this.responses.target instanceof Error) throw this.responses.target;
    if (soql.includes("SalesTarget__c")) return this.responses.target as T[];
    if (soql.includes("FROM Account")) return (this.responses.accounts ?? []) as T[];
    // クライアントランキングクエリはCALENDAR_MONTHを使わない月別集計との判別が必要
    if (soql.includes("kuraiantomei__c")) {
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

  it("builds top-client rankings per CR and re-aggregates for ALL, resolving names and 新規 via Account", async () => {
    const client = new FakeSalesforceQueryClient({
      order: [],
      completed: [],
      target: TARGET_ROW,
      orderClients: [
        { crId: "CR1", clientId: "001AAA", grossProfit: 5_000_000 },
        { crId: "CR1", clientId: "001BBB", grossProfit: 1_000_000 },
      ],
      completedClients: [{ crId: "CR2", clientId: "001CCC", grossProfit: 2_000_000 }],
      accounts: [
        { Id: "001AAA", Name: "株式会社サンプル", kuraiantogurupumei__c: "49期新規" },
        { Id: "001BBB", Name: "テスト商事", kuraiantogurupumei__c: "Ｃグループ" },
        { Id: "001CCC", Name: "デモ工業", kuraiantogurupumei__c: null },
      ],
    });
    const dataSource = new SalesforceSalesProgressDataSource(client);

    const result = await dataSource.getCrProgress();
    const cr1 = result.find((p) => p.crId === "CR1")!;
    const all = result.find((p) => p.crId === "ALL")!;

    expect(cr1.topOrderClients.map((c) => c.clientId)).toEqual(["001AAA", "001BBB"]);
    expect(cr1.topOrderClients[0].clientName).toBe("株式会社サンプル");
    expect(cr1.topOrderClients[0].isNewThisTerm).toBe(true);
    expect(cr1.topOrderClients[1].isNewThisTerm).toBe(false);

    // ALLはCR1〜3横断で再集計されるため、CR2の完了ランキングもここに含まれる
    expect(all.topCompletedClients.map((c) => c.clientId)).toEqual(["001CCC"]);
    expect(all.topCompletedClients[0].clientName).toBe("デモ工業");
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
