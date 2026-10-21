import { describe, expect, it } from "vitest";
import { classifyCashAccount } from "./cashAccountKindClassification";

describe("classifyCashAccount", () => {
  it.each([
    ["当座預金_銀行A/本店 1", "checkingSavings"],
    ["普通預金_銀行B/支店 2（東京）", "checkingSavings"],
    ["定期預金_銀行C積立", "timeDeposit"],
    ["現金", "cashOnHand"],
    ["外貨預金_銀行D", null],
    ["現金過不足", null],
  ])("%s → %s", (name, kind) => {
    expect(classifyCashAccount(name)).toBe(kind);
  });
});
