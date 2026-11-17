// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PaymentReserveSection } from "./FundSummarySection";
import { fixtureRecord } from "./referenceForecast.fixture";

afterEach(cleanup);

describe("納税・賞与の支払準備（参考）", () => {
  it("予測への反映を月末予測ごとの列に分け、含まれる支払は控除しない", () => {
    render(<PaymentReserveSection record={fixtureRecord()} />);
    expect(screen.getByRole("columnheader", { name: "11月末予測" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "12月末予測" })).toBeTruthy();
    const bonusRow = screen.getByText("bonusNet").closest("tr");
    const cells = Array.from(bonusRow?.querySelectorAll("td") ?? []).map((c) => c.textContent);
    expect(cells.slice(-2)).toEqual(["含まない → 控除", "含む（控除しない）"]);
  });

  it("控除後は「把握済みの将来支払を控除した参考残高」とし、資金余力として出さず、未算入の項目をすぐ下に出す", () => {
    render(<PaymentReserveSection record={{ ...fixtureRecord(), paymentReserve: { ...fixtureRecord().paymentReserve!, notIncluded: ["会社負担の社会保険料"] } }} />);
    expect(screen.getByText("把握済みの将来支払を控除した参考残高（当座・普通預金、標準ケース）")).toBeTruthy();
    expect(screen.queryByText(/^資金余力/)).toBeNull();
    expect(screen.getByText("この参考残高に算入していない支払")).toBeTruthy();
    expect(screen.getByText("会社負担の社会保険料")).toBeTruthy();
  });

  it("予測の計算日時と支払準備の追加日時を分けて出す", () => {
    render(<PaymentReserveSection record={fixtureRecord()} />);
    const caption = screen.getByText(/支払準備の追加/).textContent ?? "";
    expect(caption).toContain("計算 2026-11-17 09:14");
    expect(caption).toContain("支払準備の追加：2026-11-17 15:00");
    expect(caption).toContain("予測は再計算していません");
  });
});
