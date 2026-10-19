import { describe, expect, it } from "vitest";
import type { SalesforceQueryClient } from "@/services/salesforce/salesforceClient";
import type { FocusClientMaster } from "@/features/focus-clients/focusClients";
import { getFocusClients, toOwnerCrMap, toScopeTargets } from "./focusClientRepository";

const MASTER: FocusClientMaster = {
  accountId: "001000000000001AAA",
  name: "A社",
  category: "注力",
  theme: "",
  owner: "担当 一郎",
  strategy: "",
  currentStatus: "",
  monthAction: "",
  nextAction: "",
  memo: "",
  memoUpdatedBy: null,
  memoUpdatedAt: null,
  targets: {},
  updatedBy: null,
  updatedAt: null,
};

describe("toOwnerCrMap", () => {
  it("ユーザー名から所属CRを引ける。CR以外の部署・名前なしは除く", () => {
    expect(
      toOwnerCrMap([
        { Name: "担当 一郎", Department: "CR1" },
        { Name: "担当 二郎", Department: "管理部" },
        { Name: null, Department: "CR2" },
      ])
    ).toEqual({ "担当 一郎": "CR1" });
  });

  it("同名ユーザーが別CRにいる場合は振り分けない", () => {
    expect(
      toOwnerCrMap([
        { Name: "担当 一郎", Department: "CR1" },
        { Name: "担当 一郎", Department: "CR2" },
        { Name: "担当 三郎", Department: "CR3" },
        { Name: "担当 三郎", Department: "CR3" },
      ])
    ).toEqual({ "担当 三郎": "CR3" });
  });
});

describe("getFocusClients", () => {
  function clientReturning(owners: () => Promise<unknown[]>): SalesforceQueryClient {
    return {
      query: async <T,>(soql: string) => (soql.includes("FROM User") ? owners() : []) as Promise<T[]>,
    } as SalesforceQueryClient;
  }

  it("所属CRを返す", async () => {
    const result = await getFocusClients(50, {
      masters: async () => [MASTER],
      client: clientReturning(async () => [{ Name: "担当 一郎", Department: "CR2" }]),
    });
    expect(result).toMatchObject({ ok: true, ownerCrs: { "担当 一郎": "CR2" }, ownerCrsFailed: false });
  });

  it("所属CRの取得に失敗しても案件は返し、失敗を知らせる", async () => {
    const result = await getFocusClients(50, {
      masters: async () => [MASTER],
      client: clientReturning(async () => {
        throw new Error("boom");
      }),
    });
    expect(result).toMatchObject({ ok: true, deals: [], ownerCrs: {}, ownerCrsFailed: true });
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
