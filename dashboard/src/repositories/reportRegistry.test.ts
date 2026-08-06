import { describe, expect, it } from "vitest";
import type { DomainMapResult } from "./parsers/domainMapping";
import { ReportRegistry, type ReportDefinition } from "./reportRegistry";
import { SheetParseError } from "./parsers/sheetGrid";

function makeDefinition(
  name: string,
  requiredLabels: string[]
): ReportDefinition<string[][]> {
  return {
    name,
    requiredLabels,
    parser: (grid) => grid,
    domainMapper: (): DomainMapResult => ({
      order: [],
      completed: [],
      warnings: [`matched:${name}`],
    }),
  };
}

describe("ReportRegistry", () => {
  it("identifies a grid by its required labels", () => {
    const registry = new ReportRegistry();
    registry.register(makeDefinition("帳票A", ["受注", "完了"]));
    registry.register(makeDefinition("帳票B", ["ヘッダー1", "ヘッダー2"]));

    const grid = [["受注", "完了", "その他"]];
    expect(registry.identify(grid)).toBe("帳票A");
  });

  it("dispatches to the matched definition's parser and domainMapper", () => {
    const registry = new ReportRegistry();
    registry.register(makeDefinition("帳票A", ["受注", "完了"]));

    const grid = [["受注", "完了"]];
    const result = registry.parse(grid, { crId: "CR1" });
    expect(result.warnings).toEqual(["matched:帳票A"]);
  });

  it("throws a clear error when no definition matches", () => {
    const registry = new ReportRegistry();
    registry.register(makeDefinition("帳票A", ["受注", "完了"]));

    const grid = [["無関係なラベル"]];
    expect(() => registry.identify(grid)).toThrow(SheetParseError);
    expect(() => registry.identify(grid)).toThrow(/どの帳票定義にも一致しません/);
  });

  it("prefers the definition with the most required labels satisfied (より具体的な定義を優先)", () => {
    const registry = new ReportRegistry();
    // 「全社推移」相当: 緩い条件
    registry.register(makeDefinition("全社推移", ["売上", "粗利"]));
    // 「CR別」相当: 厳しい条件（全社推移の条件を包含する）
    registry.register(makeDefinition("CR別", ["受注", "完了", "売上", "粗利"]));

    // CR別のシートは「全社推移」の条件(売上,粗利)も満たしてしまうが、
    // より多くのrequiredLabelsを満たすCR別が優先されるべき
    const crGrid = [["受注", "完了", "売上", "粗利"]];
    expect(registry.identify(crGrid)).toBe("CR別");

    // 受注/完了が無ければ全社推移のみ一致
    const companyGrid = [["売上", "粗利"]];
    expect(registry.identify(companyGrid)).toBe("全社推移");
  });

  it("throws a clear error when multiple definitions tie at the same specificity", () => {
    const registry = new ReportRegistry();
    registry.register(makeDefinition("帳票A", ["売上", "粗利"]));
    registry.register(makeDefinition("帳票B", ["売上", "目標粗利"]));

    const grid = [["売上", "粗利", "目標粗利"]];
    expect(() => registry.identify(grid)).toThrow(SheetParseError);
    expect(() => registry.identify(grid)).toThrow(/一意に判定できませんでした/);
  });

  it("rejects registering a definition with no required labels", () => {
    const registry = new ReportRegistry();
    expect(() => registry.register(makeDefinition("空定義", []))).toThrow(/requiredLabelsが空/);
  });
});
