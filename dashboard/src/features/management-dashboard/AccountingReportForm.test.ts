import { describe, expect, it } from "vitest";
import { parseAmountInput } from "./AccountingReportForm";

describe("parseAmountInput", () => {
  it("accepts thousands separators, full-width digits, yen and ▲ for negatives", () => {
    expect(parseAmountInput("1,234,567")).toBe(1234567);
    expect(parseAmountInput("１２３")).toBe(123);
    expect(parseAmountInput("▲1,000円")).toBe(-1000);
    expect(parseAmountInput("-5")).toBe(-5);
    expect(parseAmountInput("  ")).toBeNull();
  });

  it("rejects decimals and text", () => {
    expect(parseAmountInput("1.5")).toBe("invalid");
    expect(parseAmountInput("約100")).toBe("invalid");
  });
});
