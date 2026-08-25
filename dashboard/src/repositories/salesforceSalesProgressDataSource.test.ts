import { afterEach, describe, expect, it, vi } from "vitest";
import { getCurrentFiscalPeriod } from "@/config/fiscalPeriods";
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
      orderLeaders?: unknown[];
      completedLeaders?: unknown[];
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
    // リーダーランキングクエリ(rida__c選択、集計クエリ)も月別集計との判別が必要
    if (soql.includes("rida__c")) {
      if (soql.includes("juchuubi__c")) return (this.responses.orderLeaders ?? []) as T[];
      if (soql.includes("seikyuubi__c")) return (this.responses.completedLeaders ?? []) as T[];
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

  it("falls back to a 0 target (not an error) when SalesTarget__c has no record for the selected term", async () => {
    // 前後1期(48/50期のような隣接期)にはまだ目標レコードが無いことがあるため、
    // 画面全体を落とさず「目標未設定」として続行する（2026-08-25、隣接期セレクター対応）
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = new FakeSalesforceQueryClient({
      order: [{ crId: "CR1", mo: 9, sales: 20_000_000, grossProfit: 6_000_000 }],
      completed: [],
      target: [],
    });
    const dataSource = new SalesforceSalesProgressDataSource(client);

    const result = await dataSource.getCrProgress(48);
    const cr1 = result.find((p) => p.crId === "CR1");

    expect(cr1?.order[0]?.targetGrossProfit).toBe(0);
    // 目標0のときは実績があっても達成率0%（NaN/Infinityにはしない）
    expect(cr1?.order.find((r) => r.month === 9)?.achievementRate).toBe(0);
    expect(warnSpy.mock.calls.some((call) => call.join(" ").includes("48期のレコードがありません"))).toBe(
      true
    );
  });

  it("returns [next, current, previous] terms without querying Salesforce", async () => {
    const { term } = getCurrentFiscalPeriod();
    const client = new FakeSalesforceQueryClient({ order: [], completed: [], target: TARGET_ROW });
    const dataSource = new SalesforceSalesProgressDataSource(client);

    await expect(dataSource.getAvailableTerms()).resolves.toEqual([term + 1, term, term - 1]);
  });

  it("builds top-client rankings per CR from clientName__c detail rows, re-aggregates for ALL, and flags 今期新規 via clientGroupName__c", async () => {
    // クライアントランキングクエリは非集計(列エイリアス不可)なので、フェイクの
    // レスポンスもフィールドAPI名そのまま(実際のSalesforceレスポンスの形)にする
    const { term } = getCurrentFiscalPeriod();
    const client = new FakeSalesforceQueryClient({
      order: [],
      completed: [],
      target: TARGET_ROW,
      orderClients: [
        {
          bumonna__c: "CR1",
          clientName__c: "株式会社サンプル",
          clientGroupName__c: `${term}期新規`,
          arari__c: 5_000_000,
        },
        {
          bumonna__c: "CR1",
          clientName__c: "テスト商事",
          clientGroupName__c: "Ｃグループ",
          arari__c: 1_000_000,
        },
      ],
      completedClients: [
        {
          bumonna__c: "CR2",
          clientName__c: "デモ工業",
          clientGroupName__c: null,
          arari__c: 2_000_000,
        },
      ],
    });
    const dataSource = new SalesforceSalesProgressDataSource(client);

    const result = await dataSource.getCrProgress();
    const cr1 = result.find((p) => p.crId === "CR1")!;
    const all = result.find((p) => p.crId === "ALL")!;

    expect(cr1.topOrderClients.map((c) => c.clientName)).toEqual(["株式会社サンプル", "テスト商事"]);
    expect(cr1.topOrderClients[0].isNewThisTerm).toBe(true);
    expect(cr1.topOrderClients[1].isNewThisTerm).toBe(false);

    // ALLはCR1〜3横断で再集計されるため、CR2の完了ランキングもここに含まれる
    expect(all.topCompletedClients.map((c) => c.clientName)).toEqual(["デモ工業"]);
    expect(all.topCompletedClients[0].isNewThisTerm).toBe(false);
  });

  it("builds top-leader rankings per CR from aliased aggregate rows and re-aggregates for ALL", async () => {
    // リーダーランキングは通常の集計クエリ(GROUP BY+エイリアス)なので、フェイクの
    // レスポンスもcrId/leaderId/leaderName/grossProfitのまま(クライアントと違い変換不要)
    const client = new FakeSalesforceQueryClient({
      order: [],
      completed: [],
      target: TARGET_ROW,
      orderLeaders: [
        { crId: "CR1", leaderId: "005AAA", leaderName: "青木 睦", grossProfit: 5_000_000 },
        { crId: "CR1", leaderId: "005BBB", leaderName: "山田 太郎", grossProfit: 1_000_000 },
      ],
      completedLeaders: [
        { crId: "CR2", leaderId: "005CCC", leaderName: "佐藤 花子", grossProfit: 2_000_000 },
      ],
    });
    const dataSource = new SalesforceSalesProgressDataSource(client);

    const result = await dataSource.getCrProgress();
    const cr1 = result.find((p) => p.crId === "CR1")!;
    const all = result.find((p) => p.crId === "ALL")!;

    expect(cr1.topOrderLeaders.map((l) => l.leaderName)).toEqual(["青木 睦", "山田 太郎"]);
    // ALLはCR1〜3横断で再集計されるため、CR2の完了ランキングもここに含まれる
    expect(all.topCompletedLeaders.map((l) => l.leaderName)).toEqual(["佐藤 花子"]);
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
