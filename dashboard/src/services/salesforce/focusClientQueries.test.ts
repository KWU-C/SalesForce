import { describe, expect, it } from "vitest";
import { buildFocusAccountsQuery } from "./focusClientQueries";

describe("buildFocusAccountsQuery", () => {
  it("ターゲット区分が注力・掘り起こしの取引先を取る", () => {
    const soql = buildFocusAccountsQuery();
    expect(soql).toContain("FROM Account");
    expect(soql).toContain("target__c IN ('注力','掘り起こし')");
    expect(soql).toContain("Tantosha__r.Department");
    expect(soql).not.toContain("Id =");
  });

  it("Account IDを渡すとその取引先に絞る", () => {
    expect(buildFocusAccountsQuery("001000000000001AAA")).toContain("AND Id = '001000000000001AAA'");
  });

  it("不正なAccount IDはSOQLに埋め込まず例外にする", () => {
    expect(() => buildFocusAccountsQuery("x' OR Id != '")).toThrow();
  });
});
