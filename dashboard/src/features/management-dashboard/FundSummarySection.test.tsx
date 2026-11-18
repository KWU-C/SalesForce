// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FundSummaryDetailSection, FundSummarySection, PaymentReserveSection } from "./FundSummarySection";
import { buildActualRow, buildForecastState } from "./fundSummary";
import { targetMonth } from "./overviewComparison";
import { fixtureRecord } from "./referenceForecast.fixture";

afterEach(cleanup);

describe("納税・賞与の支払見込額（参考）", () => {
  it("予測への反映を月末予測ごとの列に分け、含まれる支払は控除しない", () => {
    render(<PaymentReserveSection record={fixtureRecord()} />);
    expect(screen.getByRole("columnheader", { name: "11月末予測" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "12月末予測" })).toBeTruthy();
    const bonusRow = screen.getByText("bonusNet").closest("tr");
    const cells = Array.from(bonusRow?.querySelectorAll("td") ?? []).map((c) => c.textContent);
    expect(cells.slice(-2)).toEqual(["含まない → 控除", "含む（控除しない）"]);
  });

  it("控除後は「将来支払控除後」とし、準備額控除後と別の計算であることを示し、資金余力として出さず、未算入の項目をすぐ下に出す", () => {
    render(<PaymentReserveSection record={{ ...fixtureRecord(), paymentReserve: { ...fixtureRecord().paymentReserve!, notIncluded: ["会社負担の社会保険料"] } }} />);
    expect(screen.getByText("将来支払控除後（当座・普通預金、標準ケース）")).toBeTruthy();
    expect(screen.getByText(/概要の「準備額控除後」とは別の計算です/)).toBeTruthy();
    expect(screen.queryByText(/^資金余力/)).toBeNull();
    expect(screen.getByText("将来支払控除後に算入していない支払")).toBeTruthy();
    expect(screen.getByText("会社負担の社会保険料")).toBeTruthy();
  });

  it("支払見込額の計算日時・データ取得日時と、月末予測の計算日時を分けて出す", () => {
    render(<PaymentReserveSection record={fixtureRecord()} />);
    expect(screen.getByText(/^支払見込額の計算日時：2026-11-17 15:00／データ取得日時（freee）：/)).toBeTruthy();
    expect(screen.getByText("将来支払控除後に使う月末予測の計算日時：2026-11-17 09:14（支払見込額の追加時に予測は再計算していない）")).toBeTruthy();
  });
});

function fundProps() {
  const now = new Date("2026-11-17T00:00:00Z");
  const snap = (cs: number, td: number) => ({ cashClosing: cs + td + 5, checkingSavingsClosing: cs, timeDepositClosing: td, cashOnHandClosing: 5, fetchedAt: new Date("2026-11-16T08:00:00Z") });
  return {
    actualRows: [buildActualRow(targetMonth(50, 9), snap(1500, 480), now), buildActualRow(targetMonth(50, 10), snap(1200, 490), now)],
    forecast: buildForecastState(fixtureRecord(), targetMonth(50, 11)),
    record: fixtureRecord(),
  };
}

describe("資金サマリー（概要の主表）", () => {
  it("経理資料の資金繰り表に倣い、月ごとに月末残高・準備額・準備額控除後の3行、列は控除後の預金総合計・当座普通・短期借入控除・定期", () => {
    render(<FundSummarySection {...fundProps()} />);
    for (const name of ["預金総合計（差引）", "当座・普通預金", "短期借入控除", "定期預金"]) {
      expect(screen.getByRole("columnheader", { name })).toBeTruthy();
    }
    const groups = screen.getAllByRole("rowheader").map((h) => h.textContent);
    expect(groups).toEqual(["9月", "10月", "11月"]);
    const rows = screen.getAllByRole("row").slice(1).map((r) => Array.from(r.querySelectorAll("td")).map((c) => c.textContent));
    expect(rows.map((r) => r[0])).toEqual([
      "月末残高（実績）", "納税・賞与の準備額（推計）", "準備額控除後",
      "月末残高（実績）", "納税・賞与の準備額（推計）", "準備額控除後",
      "月末残高（予測）", "納税・賞与の準備額（推計）", "準備額控除後",
    ]);
    // 10月: 当座普通1,200＋定期490＝1,690、短期借入800 → 890。準備額160 → 730 / 1,040
    expect(rows[3]).toEqual(["月末残高（実績）", "890", "1,200", "-800", "490"]);
    expect(rows[4]).toEqual(["納税・賞与の準備額（推計）", "160", "", ""]);
    expect(rows[5]).toEqual(["準備額控除後", "730", "1,040", "", ""]);
  });

  it("概要には長い計算式・ケース比較・支払見込額を出さない", () => {
    render(<FundSummarySection {...fundProps()} />);
    expect(screen.queryByText(/慎重ケース/)).toBeNull();
    expect(screen.queryByText(/将来支払控除後/)).toBeNull();
    expect(screen.getByText(/経理資料の「担保」と同じ意味かは確認していません/)).toBeTruthy();
  });

  it("詳細タブ: 月末ごとの計算式(預金合計（控除前）→預金総合計（差引）→準備額控除後)を円で示す", () => {
    render(<FundSummaryDetailSection {...fundProps()} />);
    expect(screen.getByText("預金総合計（差引） 890円 ＝ 預金合計（控除前） 1,690円 − 短期借入金 800円")).toBeTruthy();
    expect(screen.getByText("賞与の準備額 120円 ＝ 見込額 160円 × 3/4か月")).toBeTruthy();
    expect(screen.getByText("準備額控除後 730円 ＝ 預金総合計（差引） 890円 − 納税・賞与の準備額（推計） 160円")).toBeTruthy();
    expect(screen.getByText(/＋ 仮定の発生額 27円 × 1か月/)).toBeTruthy();
  });
});
