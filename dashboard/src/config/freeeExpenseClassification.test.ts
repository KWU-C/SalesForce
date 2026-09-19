import { describe, expect, it } from "vitest";
import { classifyExpenseAccountItem, matchExpenseCategory } from "./freeeExpenseClassification";

describe("classifyExpenseAccountItem: 給与・人件費(旧称 人件費)", () => {
  it("includes 退職金 and [製]退職金 (previously 'other')", () => {
    expect(classifyExpenseAccountItem("退職金")).toBe("labor");
    expect(classifyExpenseAccountItem("[製]退職金")).toBe("labor");
  });

  it("keeps 社会保険(法定福利費)in 税金・社会保険等 and 福利厚生費 in 諸経費", () => {
    expect(classifyExpenseAccountItem("法定福利費")).toBe("taxSocial");
    expect(classifyExpenseAccountItem("[製]法定福利費")).toBe("taxSocial");
    expect(classifyExpenseAccountItem("福利厚生費")).toBe("otherOperating");
    expect(classifyExpenseAccountItem("[製]福利厚生費")).toBe("otherOperating");
  });

  it("maps a [製] account to its ordinary counterpart when not listed directly ([製]賞与→人件費)", () => {
    expect(classifyExpenseAccountItem("[製]賞与")).toBe("labor");
    expect(classifyExpenseAccountItem("[製]地代家賃")).toBe("otherOperating");
  });

  it("matchExpenseCategory returns null for an account on no list (caller decides その他/未分類)", () => {
    expect(matchExpenseCategory("特殊な経費")).toBeNull();
    expect(matchExpenseCategory("仮払金")).toBeNull();
  });

  it("does not treat 未払金 as labor (settlements are traced to their origin accounts)", () => {
    expect(matchExpenseCategory("未払金")).toBeNull();
  });
});
