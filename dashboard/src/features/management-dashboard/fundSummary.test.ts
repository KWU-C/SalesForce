import { describe, expect, it } from "vitest";
import {
  actualTargets,
  buildActualRow,
  buildComparisonRows,
  buildForecastState,
  forecastTimeDeposit,
  reserveDeductions,
} from "./fundSummary";
import { targetMonth } from "./overviewComparison";
import { validateReferenceForecastRecord } from "./referenceForecast";
import { fixtureRecord } from "./referenceForecast.fixture";

describe("資金サマリー(実績)", () => {
  it("締まった直近2か月を古い順に返す(期をまたぐ場合も)", () => {
    expect(actualTargets(targetMonth(50, 10)).map((t) => t.key)).toEqual(["2026-09", "2026-10"]);
    expect(actualTargets(targetMonth(50, 9)).map((t) => t.key)).toEqual(["2026-08", "2026-09"]);
  });

  it("預金総合計は当座・普通＋定期で、現金を含めない", () => {
    const row = buildActualRow(
      targetMonth(50, 10),
      { cashClosing: 1305, checkingSavingsClosing: 1000, timeDepositClosing: 300, cashOnHandClosing: 5, fetchedAt: new Date("2026-11-01T09:00:00Z") },
      new Date("2026-11-17T00:00:00Z")
    );
    expect(row).toMatchObject({ status: "fetched", checkingSavings: 1000, depositTotal: 1300 });
  });

  it("月末前に取得したスナップショットは実績にしない", () => {
    const row = buildActualRow(
      targetMonth(50, 10),
      { cashClosing: 1, checkingSavingsClosing: 1, timeDepositClosing: 0, cashOnHandClosing: 0, fetchedAt: new Date("2026-10-30T00:00:00Z") },
      new Date("2026-11-17T00:00:00Z")
    );
    expect(row.status).toBe("notFetched");
  });
});

describe("資金サマリー(予測)", () => {
  it("予測の定期預金は起点＋予測期間中の定期積立", () => {
    expect(forecastTimeDeposit(fixtureRecord(), "standard", "2026-11")).toBe(510);
    expect(forecastTimeDeposit(fixtureRecord(), "standard", "2026-12")).toBe(520);
  });

  it("当月末の標準ケースを主表示、慎重ケースと月中最低を補足、計算日時は資金予測の計算日時", () => {
    const state = buildForecastState(fixtureRecord(), targetMonth(50, 11));
    expect(state.status).toBe("available");
    if (state.status !== "available") return;
    expect(state.computedAt).toBe("2026-11-17T09:14:06+09:00");
    expect(state.row).toMatchObject({
      checkingSavings: 2000,
      depositTotal: 2510,
      cautious: { checkingSavings: 1800, depositTotal: 2310 },
      standardMin: { date: "2026-11-18", amount: 1950 },
      cautiousMin: { date: "2026-11-18", amount: 1750 },
    });
  });

  it("記録が無い・当月の予測が無いときは表示しない", () => {
    expect(buildForecastState(null, targetMonth(50, 11)).status).toBe("unavailable");
    expect(buildForecastState(fixtureRecord(), targetMonth(51, 1)).status).toBe("unavailable");
  });
});

describe("支払準備の控除後残高", () => {
  it("予測に未反映の支払見込額だけを差し引き、予測に含まれる支払は二重に引かない", () => {
    const [nov, dec] = reserveDeductions(fixtureRecord());
    // 11月末: 12月の賞与振込はまだ予測残高に含まれないので差し引く
    expect(nov.deducted.map((i) => i.id)).toEqual(["tax", "bonusNet", "bonusDed"]);
    expect(nov.balanceAfter).toBe(2000 - 250);
    // 12月末: 賞与振込は12月の予測に出金として含まれるので差し引かない
    expect(dec.included.map((i) => i.id)).toEqual(["bonusNet"]);
    expect(dec.deducted.map((i) => i.id)).toEqual(["tax", "bonusDed"]);
    expect(dec.balanceAfter).toBe(1500 - 120);
  });

  it("支払準備の無い記録では控除後残高を出さない", () => {
    expect(reserveDeductions({ ...fixtureRecord(), paymentReserve: undefined })).toEqual([]);
  });

  it("記録の検査: 支払準備の金額・対象月の形を確かめる", () => {
    expect(validateReferenceForecastRecord(fixtureRecord())).toEqual([]);
    const bad = fixtureRecord();
    bad.paymentReserve!.items[0] = { ...bad.paymentReserve!.items[0], amount: -1, targetMonth: "2027/01" };
    expect(validateReferenceForecastRecord(bad)).toHaveLength(2);
  });
});

describe("資金サマリーの主表(控除額・準備額)", () => {
  const now = new Date("2026-11-17T00:00:00Z");
  const snap = (cs: number, td: number) => ({ cashClosing: cs + td, checkingSavingsClosing: cs, timeDepositClosing: td, cashOnHandClosing: 0, fetchedAt: new Date("2026-11-16T08:00:00Z") });
  const actualRows = [buildActualRow(targetMonth(50, 9), snap(1500, 480), now), buildActualRow(targetMonth(50, 10), snap(1200, 490), now)];

  it("短期借入控除後＝預金総合計−短期借入、参考残高＝控除後−(消費税＋賞与の準備額)", () => {
    const rows = buildComparisonRows(actualRows, buildForecastState(fixtureRecord(), targetMonth(50, 11)), fixtureRecord());
    expect(rows.map((r) => [r.target.key, r.depositTotal, r.deduction, r.afterDeduction, r.reserve, r.afterReserve])).toEqual([
      ["2026-09", 1980, 800, 1180, 200, 980],
      ["2026-10", 1690, 800, 890, 160, 730],
      ["2026-11", 2510, 800, 1710, 227, 1483],
    ]);
  });

  it("実績の行に予測の値を当てない・記録に無い月は控除額・準備額を出さない", () => {
    const rec = fixtureRecord();
    rec.monthEndReserve!.months = rec.monthEndReserve!.months.map((m) => (m.month === "2026-10" ? { ...m, kind: "予測" as const } : m));
    const rows = buildComparisonRows(actualRows, buildForecastState(rec, targetMonth(50, 11)), rec);
    expect(rows[1]).toMatchObject({ depositTotal: 1690, deduction: null, afterDeduction: null, reserve: null, afterReserve: null });
    const none = buildComparisonRows(actualRows, buildForecastState(null, targetMonth(50, 11)), null);
    expect(none[2].missingReason).toContain("参考予測の記録がありません");
  });

  it("記録の検査: 準備額の合計が内訳と一致しないものは保存しない", () => {
    const bad = fixtureRecord();
    bad.monthEndReserve!.months[0] = { ...bad.monthEndReserve!.months[0], reserveTotal: 1 };
    expect(validateReferenceForecastRecord(bad)).toEqual(["準備額 2026-09 の合計が内訳と一致しません"]);
  });
});
