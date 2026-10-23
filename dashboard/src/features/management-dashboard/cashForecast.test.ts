import { describe, expect, it } from "vitest";
import { CASH_FORECAST_SETTINGS } from "@/config/cashForecastSettings";
import type { ForecastDeal } from "@/services/freee/freeeForecastClient";
import { buildCashForecast, computeGrowth } from "./cashForecast";
import type { CashForecastResult, ForecastInputs, ForecastMonth, MonthActual } from "./cashForecast";

// 金額はすべて架空の値
const S = CASH_FORECAST_SETTINGS;

function actual(overrides: Partial<MonthActual> = {}): MonthActual {
  return {
    inflowOperating: 1000,
    labor: 300,
    outsourcing: 200,
    otherOperating: 100,
    other: 10,
    taxSocial: 50,
    financing: 40,
    interest: 5,
    assetTransfer: 20,
    cashOpening: 5000,
    cashClosing: 5000,
    ...overrides,
  };
}

/** 2026-03〜2026-09 の7か月分の実績(9月末残高5000) */
function history(overrides: Record<string, Partial<MonthActual>> = {}): Record<string, MonthActual> {
  const out: Record<string, MonthActual> = {};
  for (const m of ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]) out[m] = actual(overrides[m]);
  return out;
}

function inputs(overrides: Partial<ForecastInputs> = {}): ForecastInputs {
  return {
    baseDate: "2026-10-01",
    mode: "backtest",
    actuals: history(),
    currentMonthToDate: null,
    deals: [],
    payroll: {},
    liabilities: null,
    unbookedBankTxns: [],
    walletables: [],
    transfers: [],
    timeDepositWalletableIds: [],
    failures: [],
    ...overrides,
  };
}

let nextId = 1;
function deal(overrides: Partial<ForecastDeal> & { account?: string }): ForecastDeal {
  const { account = "外注加工費", ...rest } = overrides;
  const amount = rest.amount ?? 100;
  return {
    id: nextId++,
    type: "expense",
    issueDate: "2026-09-20",
    dueDate: "2026-10-31",
    amount,
    dueAmount: amount,
    status: "unsettled",
    partnerId: null,
    details: [{ accountName: account, amount }],
    payments: [],
    ...rest,
  };
}

/** 2026-03〜09の給与明細(差引支給額300、人件費の実績と同額=比率1) */
function salaries(): ForecastInputs["payroll"] {
  const out: ForecastInputs["payroll"] = {};
  for (const m of ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]) {
    out[`salary-${m}`] = { kind: "salary", month: m, netTotal: 300, payDate: `${m}-25`, statementCount: 3, fixedCount: 3 };
  }
  return out;
}

function ok(r: CashForecastResult) {
  if (r.status !== "ok") throw new Error(`expected ok, got ${JSON.stringify(r)}`);
  return r;
}
const lineOf = (m: ForecastMonth, key: string) => m.lines.find((l) => l.key === key)!;

describe("取得失敗・データ不足", () => {
  it("does not produce any amount when a source failed", () => {
    const r = buildCashForecast(inputs({ failures: [{ source: "deals", kind: "forbidden" }] }), S);
    expect(r).toEqual({ status: "failed", baseDate: "2026-10-01", failures: [{ source: "deals", kind: "forbidden" }] });
  });

  it("fails instead of starting from 0 when the previous month-end balance is missing", () => {
    const actuals = history();
    delete actuals["2026-09"];
    const r = buildCashForecast(inputs({ actuals }), S);
    expect(r).toMatchObject({ status: "failed", failures: [{ source: "monthly_cash_flow" }] });
  });

  it("marks lines it cannot estimate as unreflected (not 0) and the balance as reference only", () => {
    const actuals = { "2026-09": actual() };
    const r = ok(buildCashForecast(inputs({ actuals }), S));
    const oct = r.months[0];
    expect(lineOf(oct, "otherOperating").adopted).toBeNull();
    expect(oct.unreflected.map((u) => u.key)).toContain("otherOperating");
    expect(oct.closingBasis).toBe("excludesUnreflected");
    expect(r.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(["insufficient_history", "growth_unavailable"]));
  });
});

describe("伸び率", () => {
  it("is unavailable (1) without six months of history", () => {
    const g = computeGrowth(inputs({ actuals: { "2026-09": actual(), "2026-08": actual() } }), S);
    expect(g).toMatchObject({ raw: null, applied: 1 });
  });

  it("clamps to the configured range and records the raw value", () => {
    const actuals = history({ "2026-07": { inflowOperating: 1400 }, "2026-08": { inflowOperating: 1400 }, "2026-09": { inflowOperating: 1400 } });
    const g = computeGrowth(inputs({ actuals }), S);
    expect(g.raw).toBeCloseTo(1.4);
    expect(g).toMatchObject({ applied: 1.15, clamped: true });
    expect(computeGrowth(inputs({ actuals }), { ...S, growthClamp: { min: 0.5, max: 2 } }).applied).toBeCloseTo(1.4);
  });

  it("winsorizes one-off months before computing the rate", () => {
    const actuals = history({ "2026-09": { inflowOperating: 5000 } });
    const g = computeGrowth(inputs({ actuals }), S);
    expect(g.winsorizedMonths).toEqual(["2026-09"]);
    // 5000 は中央値1000の1.5倍=1500に切り詰め: (1000+1000+1500)/3 ÷ 1000
    expect(g.raw).toBeCloseTo(3500 / 3 / 1000);
  });
});

describe("二重計上の防止", () => {
  it("takes the larger of scheduled and estimated, never their sum", () => {
    const r = ok(buildCashForecast(inputs({ deals: [deal({ account: "通信費", amount: 160, dueDate: "2026-11-30" })] }), S));
    const nov = lineOf(r.months[1], "otherOperating");
    expect(nov).toMatchObject({ scheduled: { amount: 160 }, estimated: { amount: 100 }, adopted: 160, rule: "max" });
    const dec = lineOf(r.months[2], "otherOperating");
    expect(dec).toMatchObject({ scheduled: null, adopted: 100, rule: "estimated" });
  });

  it("supplements loans per lender only for the unregistered part (not all-or-nothing)", () => {
    const paid = (partnerId: number, month: string, amount: number): ForecastDeal =>
      deal({ account: "長期借入金", partnerId, issueDate: `${month}-25`, dueDate: `${month}-25`, amount, dueAmount: 0, status: "settled", payments: [{ date: `${month}-25`, amount, walletableType: "bank_account", walletableId: 1 }] });
    const history3 = (partnerId: number, amount: number) => ["2026-07", "2026-08", "2026-09"].map((m) => paid(partnerId, m, amount));
    const scheduled = (partnerId: number, amount: number) => deal({ account: "長期借入金", partnerId, issueDate: "2026-10-25", dueDate: "2026-10-25", amount });
    const r = ok(
      buildCashForecast(
        inputs({
          deals: [
            ...history3(1, 100), // 一部登録(40) → 60を補完
            scheduled(1, 40),
            ...history3(2, 100), // ほぼ全額登録(95 ≥ 90%) → 補完しない
            scheduled(2, 95),
            ...history3(3, 50), // 未登録 → 50を補完
            scheduled(4, 30), // 実績の無い借入先 → 予定だけ
          ],
        }),
        S
      )
    );
    expect(lineOf(r.months[0], "loans")).toMatchObject({ scheduled: { amount: 165 }, estimated: { amount: 110 }, adopted: 275, rule: "scheduled+supplement" });
    // 画面に出す件数は借入先の実数(1・2・3)、延べ件数は 当月2先＋翌月以降5か月×3先
    expect(r.warnings.find((w) => w.code === "loan_supplemented")).toMatchObject({ count: 3, occurrences: 17 });
    expect(r.warnings.find((w) => w.code === "loan_supplemented")!.message).toContain("(3先)");
  });

  it("adds the company-wide repayment floor only for the shortfall (irregular lenders get no per-lender median)", () => {
    const actuals = history({ "2026-07": { financing: 200, interest: 0 }, "2026-08": { financing: 200, interest: 0 }, "2026-09": { financing: 200, interest: 0 } });
    const registered = deal({ account: "長期借入金", partnerId: 1, issueDate: "2026-10-25", dueDate: "2026-10-25", amount: 120 });
    const withFloor = ok(buildCashForecast(inputs({ actuals, deals: [registered] }), S));
    expect(lineOf(withFloor.months[0], "loans")).toMatchObject({ scheduled: { amount: 120 }, estimated: { amount: 80 }, adopted: 200 });
    const noFloor = ok(buildCashForecast(inputs({ actuals, deals: [registered] }), { ...S, loanAggregateFloor: false }));
    expect(lineOf(noFloor.months[0], "loans").adopted).toBe(120);
    // 予定が下限を上回るときは足さない
    const big = deal({ account: "長期借入金", partnerId: 1, issueDate: "2026-10-25", dueDate: "2026-10-25", amount: 300 });
    expect(lineOf(ok(buildCashForecast(inputs({ actuals, deals: [big] }), S)).months[0], "loans").adopted).toBe(300);
  });

  it("in the live current month adds only the unpaid scheduled part on top of the actual so far", () => {
    const r = ok(
      buildCashForecast(
        inputs({
          mode: "live",
          baseDate: "2026-10-15",
          currentMonthToDate: actual({ otherOperating: 70, labor: 300, inflowOperating: 400 }),
          deals: [deal({ account: "通信費", amount: 50 }), deal({ type: "income", account: "売上高", amount: 500 })],
          payroll: { "salary-2026-10": { kind: "salary", month: "2026-10", netTotal: 300, payDate: "2026-10-25", statementCount: 3, fixedCount: 3 } },
        }),
        S
      )
    );
    const oct = r.months[0];
    // 諸経費: max(月の推計100, 実績70＋未払の予定50) = 120(170にも100にもならない)
    expect(lineOf(oct, "otherOperating")).toMatchObject({ toDate: 70, adopted: 120, rule: "toDate+remaining" });
    // 給与: 明細は月全体の額なので実績に足さない
    expect(lineOf(oct, "labor").adopted).toBe(300);
    // 営業入金: 実績400＋未回収の予定500
    expect(lineOf(oct, "inflowOperating").adopted).toBe(900);
  });

  it("counts an unbooked bank txn only when it matches a scheduled deal; otherwise warns without changing the balance", () => {
    const overdue = deal({ type: "income", account: "売上高", amount: 300, dueDate: "2026-10-10" });
    const base = inputs({ mode: "live", baseDate: "2026-10-15", currentMonthToDate: actual({ inflowOperating: 0 }), deals: [overdue] });
    const without = ok(buildCashForecast(base, S));
    expect(lineOf(without.months[0], "inflowOperating").adopted).toBe(0);
    expect(without.warnings.find((w) => w.code === "overdue_receivables")).toMatchObject({ amount: 300, count: 1 });

    const txn = { date: "2026-10-12", entrySide: "income" as const, amount: 300, dueAmount: 300, status: 1, walletableType: "bank_account", walletableId: 1 };
    const matched = ok(buildCashForecast({ ...base, unbookedBankTxns: [txn] }, S));
    expect(lineOf(matched.months[0], "inflowOperating").adopted).toBe(300);
    expect(matched.warnings.find((w) => w.code === "overdue_receivables")).toBeUndefined();
    expect(matched.warnings.find((w) => w.code === "unbooked_matched")).toMatchObject({ amount: 300, count: 1 });

    const stranger = { ...txn, amount: 777, dueAmount: 777, entrySide: "expense" as const };
    const unmatched = ok(buildCashForecast({ ...base, unbookedBankTxns: [stranger] }, S));
    expect(unmatched.months[0].closingBalance).toBe(without.months[0].closingBalance);
    expect(unmatched.warnings.find((w) => w.code === "unbooked_unmatched")).toMatchObject({ amount: 777, count: 1 });
  });

  it("does not add a lump tax already registered as a deal on top of the liability", () => {
    const liabilities = { asOfMonth: "2026-09", balances: { 未払法人税等: 600, 未払消費税等: 400 } };
    const registered = deal({ account: "租税公課", amount: 1050, dueDate: "2026-10-31" });
    const r = ok(buildCashForecast(inputs({ liabilities, deals: [registered] }), S));
    const oct = r.months[0];
    const total = lineOf(oct, "taxSocial").adopted! + lineOf(oct, "taxLump").adopted!;
    // 中央値50＋確定分1000 = 1050。登録済み1050と合わせて2100にはしない
    expect(total).toBe(1050);
  });
});

describe("未反映の支出", () => {
  it("flags a bonus month without statements and marks that month and later as reference only", () => {
    const r = ok(buildCashForecast(inputs({ baseDate: "2026-10-01", payroll: salaries() }), S));
    const [oct, nov, dec, jan] = r.months;
    expect(dec.unreflected.map((u) => u.key)).toContain("bonus");
    expect(lineOf(dec, "bonus").adopted).toBeNull();
    expect([nov.closingBasis, dec.closingBasis, jan.closingBasis]).toEqual(["excludesUnreflected", "excludesUnreflected", "excludesUnreflected"]);
    // 10月は確定申告分の根拠(負債残高)が無いので未反映
    expect(oct.unreflected.map((u) => u.key)).toEqual(["taxLump"]);
    expect(r.warnings.find((w) => w.code === "unreflected")?.count).toBeGreaterThanOrEqual(2);
  });

  it("uses the bonus statement when it exists", () => {
    const payroll = { ...salaries(), "bonus-2026-12": { kind: "bonus" as const, month: "2026-12", netTotal: 900, payDate: "2026-12-10", statementCount: 3, fixedCount: 3 } };
    const liabilities = { asOfMonth: "2026-09", balances: { 未払法人税等: 600, 未払消費税等: 400 } };
    const r = ok(buildCashForecast(inputs({ payroll, liabilities }), S));
    expect(lineOf(r.months[2], "bonus")).toMatchObject({ adopted: 900, scheduled: { source: "bonus_statements" } });
    expect(r.months.every((m) => m.closingBasis === "complete")).toBe(true);
  });
});

describe("基準日時点の情報だけを使う(バックテスト)", () => {
  it("ignores deals issued after the base date but keeps future loan schedules, and uses the unpaid part at the base date", () => {
    const later = deal({ account: "通信費", amount: 999, issueDate: "2026-10-05", dueDate: "2026-11-30" });
    const loan = deal({ account: "長期借入金", amount: 70, issueDate: "2026-11-25", dueDate: "2026-11-25", partnerId: 9 });
    const partlyPaid = deal({ account: "通信費", amount: 300, dueDate: "2026-11-30", status: "settled", dueAmount: 0, payments: [{ date: "2026-09-30", amount: 100, walletableType: "bank_account", walletableId: 1 }, { date: "2026-11-30", amount: 200, walletableType: "bank_account", walletableId: 1 }] });
    const r = ok(buildCashForecast(inputs({ deals: [later, loan, partlyPaid] }), S));
    const nov = r.months[1];
    expect(lineOf(nov, "otherOperating").scheduled).toMatchObject({ amount: 200, count: 1 });
    expect(lineOf(nov, "loans").scheduled).toMatchObject({ amount: 70 });
  });
});

describe("区分と参考変動幅", () => {
  it("labels the first two months as forecast and the rest as estimate, with a widening reference range", () => {
    const actuals = history({ "2026-05": { otherOperating: 140 }, "2026-07": { otherOperating: 60 }, "2026-08": { otherOperating: 130 } });
    const r = ok(buildCashForecast(inputs({ actuals }), S));
    expect(r.months.map((m) => m.tier)).toEqual(["forecast", "forecast", "estimate", "estimate", "estimate", "estimate"]);
    const ranges = r.months.map((m) => m.referenceRange ?? 0);
    expect(ranges[5]).toBeGreaterThan(ranges[2]);
    expect(ranges.every((x, i) => i === 0 || x >= ranges[i - 1])).toBe(true);
  });
});

describe("給与の支払確認(当月)", () => {
  const payroll = { "salary-2026-10": { kind: "salary" as const, month: "2026-10", netTotal: 300, payDate: "2026-10-25", statementCount: 3, fixedCount: 3 } };
  const base = { mode: "live" as const, baseDate: "2026-10-27", currentMonthToDate: actual(), payroll };

  it("warns when the pay date has passed without a bank payment of at least the net total", () => {
    const r = ok(buildCashForecast(inputs(base), S));
    expect(r.warnings.find((w) => w.code === "payroll_payment_unconfirmed")).toMatchObject({ amount: 300 });
  });

  it("does not warn when a salary payment (with reimbursements, so slightly larger) was made before the pay date", () => {
    const paid = deal({ account: "給料手当", amount: 320, issueDate: "2026-10-20", status: "settled", dueAmount: 0, payments: [{ date: "2026-10-20", amount: 320, walletableType: "bank_account", walletableId: 1 }] });
    const r = ok(buildCashForecast(inputs({ ...base, deals: [paid] }), S));
    expect(r.warnings.find((w) => w.code === "payroll_payment_unconfirmed")).toBeUndefined();
  });
});

describe("給与明細の採用(作成途中の判定)", () => {
  type Payroll = ForecastInputs["payroll"];
  const salary = (month: string, statementCount: number, netTotal: number, fixedCount: number): Payroll => ({
    [`salary-${month}`]: { kind: "salary", month, netTotal, payDate: `${month}-25`, statementCount, fixedCount },
  });
  /** 2026-03〜10は全件確定の51件(差引支給額5100) */
  const fixedThroughOctober = (): Payroll => {
    let out: Payroll = {};
    for (const m of ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]) out = { ...out, ...salary(m, 51, 5100, 51) };
    return out;
  };
  const run = (payroll: Payroll) => ok(buildCashForecast(inputs({ payroll }), S));

  it("estimates November from the latest fixed statement when only 25 of the usual 51 unfixed statements exist", () => {
    const r = run({ ...fixedThroughOctober(), ...salary("2026-11", 25, 2500, 0) });
    const oct = lineOf(r.months[0], "labor");
    const nov = lineOf(r.months[1], "labor");
    expect(oct).toMatchObject({ rule: "scheduled", scheduled: { count: 51 } });
    expect(nov).toMatchObject({ rule: "estimated", scheduled: null, estimated: { basisMonths: ["2026-10"] } });
    // 作成途中の明細(2500)ではなく、10月の確定済み明細(5100)×実績比率
    expect(nov.adopted).toBeCloseTo(oct.adopted!);
    const w = r.warnings.find((x) => x.code === "payroll_incomplete")!;
    expect(w.count).toBe(1);
    expect(w.message).toContain("2026-11");
    expect(w.message).toContain("件数25/51件");
  });

  it("does not adopt unfixed statements on the count alone (90% of the count but far less in amount)", () => {
    const r = run({ ...fixedThroughOctober(), ...salary("2026-11", 50, 3000, 0) });
    expect(lineOf(r.months[1], "labor").rule).toBe("estimated");
  });

  it("adopts unfixed statements close in both count and amount, but only as provisional (not fixed)", () => {
    const r = run({ ...fixedThroughOctober(), ...salary("2026-11", 51, 5200, 0) });
    expect(lineOf(r.months[1], "labor")).toMatchObject({ rule: "scheduled", scheduled: { count: 51, provisional: true } });
    expect(r.warnings.find((x) => x.code === "payroll_unfixed_adopted")).toMatchObject({ count: 1 });
    expect(r.warnings.find((x) => x.code === "payroll_incomplete")).toBeUndefined();
  });

  it("prefers freee's fixed state when every statement of the month is fixed, even with fewer statements", () => {
    const r = run({ ...fixedThroughOctober(), ...salary("2026-11", 25, 2500, 25) });
    const nov = lineOf(r.months[1], "labor");
    expect(nov).toMatchObject({ rule: "scheduled", scheduled: { count: 25 } });
    expect(nov.scheduled!.provisional).toBeUndefined();
  });

  it("treats an unfixed month as incomplete when there is no fixed month to compare with", () => {
    const r = run({ ...salary("2026-10", 51, 5100, 0) });
    expect(lineOf(r.months[0], "labor")).toMatchObject({ rule: "none", adopted: null });
    expect(r.months[0].unreflected.map((u) => u.key)).toContain("labor");
  });

  it("estimates later months only from fixed statements and ignores unfixed ones for the labor ratio", () => {
    const r = run({ ...fixedThroughOctober(), ...salary("2026-11", 25, 2500, 0) });
    expect(lineOf(r.months[2], "labor").estimated!.basisMonths).toEqual(["2026-10"]);
  });

  it("leaves an unfixed bonus statement unreflected instead of adopting a partial amount", () => {
    const payroll = { ...fixedThroughOctober(), "bonus-2026-12": { kind: "bonus" as const, month: "2026-12", netTotal: 400, payDate: "2026-12-10", statementCount: 20, fixedCount: 0 } };
    const r = run(payroll);
    const dec = r.months.find((m) => m.month === "2026-12")!;
    expect(lineOf(dec, "bonus")).toMatchObject({ adopted: null, rule: "none" });
    expect(dec.unreflected.find((u) => u.key === "bonus")!.reason).toContain("未確定");
    expect(dec.closingBasis).toBe("excludesUnreflected");
  });
});
