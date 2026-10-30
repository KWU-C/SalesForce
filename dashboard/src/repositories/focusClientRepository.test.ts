import { describe, expect, it } from "vitest";
import type { SalesforceQueryClient } from "@/services/salesforce/salesforceClient";
import type { FocusClientDashboardFields } from "./focusClientMasterRepository";
import { getFocusClients, mergeFocusClients, toScopeTargets } from "./focusClientRepository";
import type { RawFocusAccountRow } from "./focusClientRepository";

function account(overrides: Partial<RawFocusAccountRow> = {}): RawFocusAccountRow {
  return {
    Id: "001000000000001AAA",
    Name: "A社",
    target__c: "注力",
    Tantosha__r: { Name: "担当 一郎", Department: "CR4" },
    Thema__c: "テーマ",
    mokuhyouuriage_eigyou__c: 1000,
    mokuhyouarari_eigyou__c: 300,
    ...overrides,
  };
}

function saved(overrides: Partial<FocusClientDashboardFields> = {}): FocusClientDashboardFields {
  return {
    accountId: "001000000000001AAA",
    strategy: "戦略",
    currentStatus: "",
    monthAction: "",
    nextAction: "",
    memo: "メモ",
    memoUpdatedBy: null,
    memoUpdatedAt: null,
    targets: {},
    updatedBy: null,
    updatedAt: null,
    ...overrides,
  };
}

describe("mergeFocusClients", () => {
  it("会社名・区分・担当・テーマ・CR・当期目標はSalesforce、メモ等はダッシュボード側の値を使う", () => {
    const [merged] = mergeFocusClients([account()], new Map([["001000000000001AAA", saved()]]), 50);
    expect(merged).toMatchObject({
      accountId: "001000000000001AAA",
      name: "A社",
      category: "注力",
      owner: "担当 一郎",
      crId: "CR4",
      theme: "テーマ",
      strategy: "戦略",
      memo: "メモ",
      targets: { "50": { sales: 1000, grossProfit: 300 } },
    });
  });

  it("当期の目標はダッシュボードに保存した値より取引先を優先し、過去の期の目標は残す", () => {
    const fields = saved({ targets: { "49": { sales: 1, grossProfit: 2 }, "50": { sales: 9, grossProfit: 9 } } });
    const [merged] = mergeFocusClients(
      [account({ mokuhyouuriage_eigyou__c: null, mokuhyouarari_eigyou__c: null })],
      new Map([["001000000000001AAA", fields]]),
      50
    );
    expect(merged.targets).toEqual({ "49": { sales: 1, grossProfit: 2 }, "50": { sales: null, grossProfit: null } });
  });

  it("ダッシュボード側に無い社は空の項目で出し、Salesforceに無い社は出さない", () => {
    const merged = mergeFocusClients(
      [account({ Id: "001000000000002AAA", Name: "B社" })],
      new Map([["001000000000001AAA", saved()]]),
      50
    );
    expect(merged.map((m) => [m.accountId, m.memo])).toEqual([["001000000000002AAA", ""]]);
  });

  it("担当なし・部署がCR1〜4でない社はCRなし", () => {
    const merged = mergeFocusClients(
      [account({ Tantosha__r: null }), account({ Id: "001000000000002AAA", Tantosha__r: { Name: "担当 二郎", Department: "管理部" } })],
      new Map(),
      50
    );
    expect(merged.map((m) => [m.owner, m.crId])).toEqual([
      ["", null],
      ["担当 二郎", null],
    ]);
  });
});

describe("getFocusClients", () => {
  function clientReturning(handlers: { accounts?: () => Promise<unknown[]>; deals?: () => Promise<unknown[]> }): SalesforceQueryClient {
    return {
      query: async <T,>(soql: string) => {
        if (soql.includes("FROM Account")) return (handlers.accounts ?? (async () => [account()]))() as Promise<T[]>;
        if (soql.includes("FROM Process__c")) return (handlers.deals ?? (async () => []))() as Promise<T[]>;
        return [] as T[];
      },
    } as SalesforceQueryClient;
  }

  it("取引先一覧とダッシュボード側の項目を合わせて返す", async () => {
    const result = await getFocusClients(50, 50, {
      dashboardFields: async () => new Map([["001000000000001AAA", saved()]]),
      client: clientReturning({}),
    });
    expect(result).toMatchObject({ ok: true, masters: [{ name: "A社", crId: "CR4", memo: "メモ" }], deals: [] });
  });

  it("取引先一覧の取得に失敗したらsalesforceの失敗を返す", async () => {
    const result = await getFocusClients(50, 50, {
      dashboardFields: async () => new Map(),
      client: clientReturning({
        accounts: async () => {
          throw new Error("boom");
        },
      }),
    });
    expect(result).toEqual({ ok: false, failed: "salesforce" });
  });

  it("ダッシュボード側の項目の取得に失敗したらmasterの失敗を返す", async () => {
    const result = await getFocusClients(50, 50, {
      dashboardFields: async () => {
        throw new Error("boom");
      },
      client: clientReturning({}),
    });
    expect(result).toEqual({ ok: false, failed: "master" });
  });
});

describe("toScopeTargets", () => {
  it("全社目標とCR別目標を返す。未設定・レコードなしはnull", () => {
    expect(toScopeTargets({ TargetGrossProfit__c: 300, CR1TargetGrossProfit__c: 100, CR2TargetGrossProfit__c: null })).toEqual({
      ALL: 300,
      CR1: 100,
      CR2: null,
      CR3: null,
      CR4: null,
    });
    expect(toScopeTargets(undefined)).toEqual({ ALL: null, CR1: null, CR2: null, CR3: null, CR4: null });
  });
});
