import { classifyCashAccount } from "@/config/cashAccountKindClassification";
import type { CashForecastSettings } from "@/config/cashForecastSettings";
import { getFreeeCompanyId } from "@/repositories/freeeAuthRepository";
import { getMonthlyCashFlowSnapshot } from "@/repositories/monthlyCashFlowSnapshotRepository";
import * as freee from "@/services/freee/freeeForecastClient";
import type { ForecastDeal, PayrollMonth } from "@/services/freee/freeeForecastClient";
import { targetMonthPeriod } from "./accountingReports";
import { addMonths } from "./cashForecast";
import type { ForecastInputs, MonthActual, SourceFailure, YearMonth } from "./cashForecast";
import type { MonthlyCashFlow } from "./types";

/**
 * 資金繰り予測(段階3)の実運用の入力を取りまとめる。freeeは読み取りだけ、Firestoreは
 * 月次資金収支スナップショットを読むだけで、ここでは何も保存しない(ユーザー確定、2026-10-21)。
 *
 * どの取得元も失敗したら、その種類を failures に入れる(予測の計算側は failures が1つでもあれば
 * 予測値を作らない)。失敗を0件・0円として扱わない。
 */

export interface CollectDeps {
  getCompanyId?: () => Promise<number | null>;
  getSnapshot?: (fiscalYear: number, month: number) => Promise<MonthlyCashFlow | null>;
  client?: Pick<
    typeof freee,
    "listAccountItemNames" | "listDeals" | "getPayrollMonth" | "getMonthEndAccountBalances" | "listWalletTxns" | "listWalletables" | "listTransfers"
  >;
}

function firstDay(month: YearMonth): string {
  return `${month}-01`;
}

function dayBefore(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** 月次資金収支スナップショット → 予測の実績1か月分。区分内訳が無い(旧ロジックの)月は使わない */
export function toMonthActual(s: MonthlyCashFlow): MonthActual | null {
  if (!s.inflow || !s.outflow) return null;
  return {
    inflowOperating: s.inflow.operating,
    labor: s.outflow.labor,
    outsourcing: s.outflow.outsourcing,
    otherOperating: s.outflow.otherOperating,
    other: s.outflow.other,
    taxSocial: s.outflow.taxSocial,
    financing: s.outflow.financing,
    interest: s.outflow.interest,
    assetTransfer: s.outflow.assetTransfer,
    cashOpening: s.cashOpening,
    cashClosing: s.cashClosing,
    timeDepositClosing: s.timeDepositClosing ?? null,
    cashOnHandClosing: s.cashOnHandClosing ?? null,
  };
}

function failureOf(source: string, error: unknown): SourceFailure {
  if (error instanceof freee.FreeeReadError) return { source: error.source, kind: error.kind };
  return { source, kind: "other" };
}

/**
 * 基準日(YYYY-MM-DD、日本時間の今日)の予測の入力を集める。freeeの呼び出しは20〜30回程度
 * (取引のページ数による)。currentMonthSnapshotFetchedAt は、当月の途中までの実績がいつ時点の
 * ものかを記録に残すために返す。
 */
export async function collectForecastInputs(
  baseDate: string,
  settings: CashForecastSettings,
  deps: CollectDeps = {}
): Promise<{
  inputs: ForecastInputs;
  currentMonthSnapshotFetchedAt: string | null;
  /** 月ごとの月次資金収支スナップショットの取得日時(鮮度の確認用)。スナップショットが無い月は含めない */
  snapshotFetchedAt: Record<YearMonth, string>;
}> {
  const client = deps.client ?? freee;
  const getSnapshot = deps.getSnapshot ?? getMonthlyCashFlowSnapshot;
  const baseMonth = baseDate.slice(0, 7);
  const failures: SourceFailure[] = [];
  const attempt = async <T>(source: string, read: () => Promise<T>): Promise<T | null> => {
    try {
      return await read();
    } catch (error) {
      failures.push(failureOf(source, error));
      return null;
    }
  };

  const empty: ForecastInputs = {
    baseDate,
    mode: "live",
    actuals: {},
    currentMonthToDate: null,
    deals: [],
    payroll: {},
    liabilities: null,
    unbookedBankTxns: [],
    walletables: [],
    transfers: [],
    timeDepositWalletableIds: [],
    failures,
  };

  const companyId = await attempt("freee_connection", () => (deps.getCompanyId ?? getFreeeCompanyId)());
  if (companyId === null) {
    if (failures.length === 0) failures.push({ source: "freee_connection", kind: "not_connected" });
    return { inputs: empty, currentMonthSnapshotFetchedAt: null, snapshotFetchedAt: {} };
  }

  // 実績(前月まで6か月分)と当月の途中まで。月次資金収支スナップショットを読むだけ
  const actuals: Record<YearMonth, MonthActual> = {};
  let currentMonthToDate: MonthActual | null = null;
  let currentFetchedAt: string | null = null;
  const snapshotFetchedAt: Record<YearMonth, string> = {};
  for (let k = 6; k >= 0; k--) {
    const month = addMonths(baseMonth, -k);
    const { fiscalYear, month: calMonth } = targetMonthPeriod(month);
    const snapshot = await attempt("monthly_cash_flow", () => getSnapshot(fiscalYear, calMonth));
    const actual = snapshot ? toMonthActual(snapshot) : null;
    if (snapshot) snapshotFetchedAt[month] = snapshot.fetchedAt.toISOString();
    if (k === 0) {
      currentMonthToDate = actual;
      currentFetchedAt = snapshot ? snapshot.fetchedAt.toISOString() : null;
    } else if (actual) {
      actuals[month] = actual;
    }
  }

  const names = await attempt("account_items", () => client.listAccountItemNames(companyId));
  const dealMap = new Map<number, ForecastDeal>();
  if (names) {
    const unsettled = await attempt("deals", () => client.listDeals(companyId, { status: "unsettled" }, names));
    // 借入返済の実績と給与の支払確認に使う、直近3か月〜基準日の取引(決済済みを含む)
    const recentDeals = await attempt("deals", () =>
      client.listDeals(companyId, { startIssueDate: firstDay(addMonths(baseMonth, -3)), endIssueDate: baseDate }, names)
    );
    for (const d of [...(unsettled ?? []), ...(recentDeals ?? [])]) dealMap.set(d.id, d);
  }

  // 給与明細は実績比率と直近の明細のため過去6か月〜翌月、賞与明細は当月〜予測期間の支給月だけ
  const payroll: Record<string, PayrollMonth> = {};
  const payrollTargets: { kind: "salary" | "bonus"; month: YearMonth }[] = [];
  for (let k = -6; k <= 1; k++) payrollTargets.push({ kind: "salary", month: addMonths(baseMonth, k) });
  for (let k = 0; k < settings.horizonMonths; k++) {
    const month = addMonths(baseMonth, k);
    if (settings.bonusMonths.includes(Number(month.slice(5)))) payrollTargets.push({ kind: "bonus", month });
  }
  for (const { kind, month } of payrollTargets) {
    const [y, m] = month.split("-").map(Number);
    const p = await attempt(kind === "salary" ? "salary_statements" : "bonus_statements", () => client.getPayrollMonth(companyId, kind, y, m));
    if (p) payroll[`${kind}-${month}`] = p;
  }

  // 一時的な納付の根拠にする負債科目の、前月末の残高
  const prevMonth = addMonths(baseMonth, -1);
  const lumpAccounts = [...new Set(settings.taxLumpSchedule.flatMap((s) => s.liabilityAccounts))];
  const { fiscalYear: prevFy, month: prevCal } = targetMonthPeriod(prevMonth);
  const balances = lumpAccounts.length > 0 ? await attempt("trial_bs", () => client.getMonthEndAccountBalances(companyId, prevFy, prevCal, lumpAccounts)) : {};

  const txns = await attempt("wallet_txns", () => client.listWalletTxns(companyId, firstDay(baseMonth), baseDate));
  const walletables = await attempt("walletables", () => client.listWalletables(companyId));
  const transfers = await attempt("transfers", () => client.listTransfers(companyId, firstDay(addMonths(baseMonth, -3)), dayBefore(firstDay(baseMonth))));

  return {
    inputs: {
      ...empty,
      actuals,
      currentMonthToDate,
      deals: [...dealMap.values()],
      payroll,
      liabilities: balances ? { asOfMonth: prevMonth, balances } : null,
      // 帳簿未登録(未処理)の銀行口座の明細だけ。照合できたものだけが予測に入る(計算側)
      unbookedBankTxns: (txns ?? []).filter((t) => t.status === 1 && t.walletableType === "bank_account"),
      walletables: walletables ?? [],
      transfers: transfers ?? [],
      timeDepositWalletableIds: (walletables ?? []).filter((w) => classifyCashAccount(w.name) === "timeDeposit").map((w) => w.id),
    },
    currentMonthSnapshotFetchedAt: currentFetchedAt,
    snapshotFetchedAt,
  };
}
