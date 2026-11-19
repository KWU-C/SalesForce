import { EXTERNAL_CASH_FLOW_CALCULATION_VERSION } from "../externalCashFlow";
import { REFERENCE_FORECAST_ENGINE_VERSION, REFERENCE_FORECAST_SCHEMA_VERSION, type ReferenceForecastRecord } from "../referenceForecast";
import { addMonths } from "./calendar";
import { computeCash } from "./cashEngine";
import { computeReserves } from "./reserve";
import { matchSales } from "./salesMatching";
import type { RfDeal, RfInputs, RfManualJournal } from "./types";

/**
 * 画面の再計算(DEV 2026-11-18、本番 2026-11-19)。集めた入力から、資金予測・入金照合・準備額・支払見込額を計算して1件の記録にする。
 * 損益(pl)は再計算せず、同じデータベースの直前の記録の値を引き継ぐ(plCarriedFrom に元の記録ID)。直前の記録が無ければ空(未計算)。
 */
export function buildReferenceForecastRecord(
  inp: RfInputs,
  opts: {
    createdBy: string;
    codeCommit: string;
    previous: ReferenceForecastRecord | null;
    computeMode?: "devRecompute" | "prodRecompute";
    codeRevision?: string;
  }
): { record: ReferenceForecastRecord; warnings: string[] } {
  const base = inp.bankSyncedThrough;
  const M = base.slice(0, 7);
  const { events, summary } = matchSales(inp.sfProcesses, inp.incomeDeals, inp.partners, base, `${addMonths(M, -1)}-01`, `${addMonths(M, -2)}-01`);
  const cash = computeCash(inp, events);
  const reserves = computeReserves(inp);
  const { monthEndReserve, paymentReserve } = reserves;
  const warnings = [
    ...reserves.warnings,
    ...(inp.sfCosts === null ? ["Salesforceの原価(Cost__c)を取得できなかったため、慎重ケースの未登録外注は「未取得」です。慎重ケースはこの支出を含めていません(連携ユーザーの参照権限・接続を確認)"] : []),
  ];
  const stamp = inp.computedAt.slice(0, 19).replace(/[-:]/g, "");
  const prev = opts.previous;
  const prevHasPl = !!prev && prev.pl.scenarios.length > 0;
  const plCarriedFrom = prevHasPl ? (prev.plCarriedFrom ?? prev.carriedFrom ?? prev.derivedFrom ?? prev.id) : null;
  const record: ReferenceForecastRecord = {
    schemaVersion: REFERENCE_FORECAST_SCHEMA_VERSION,
    id: `${base}_${stamp}`,
    baseDate: base,
    createdAt: inp.computedAt,
    createdBy: opts.createdBy,
    codeCommit: opts.codeCommit,
    dataFetchedAt: { freee: inp.computedAt, salesforce: inp.computedAt },
    cash: {
      startBalance: cash.startBalances.checking,
      startTimeDeposit: cash.startBalances.timeDeposit,
      startCash: cash.startBalances.cash,
      cases: cash.cases,
      dec31Receipts: cash.dec31Receipts,
      checks: cash.checks as ReferenceForecastRecord["cash"]["checks"],
    },
    matching: summary,
    pl: prevHasPl ? prev.pl : { scenarios: [] },
    notes: {
      basis: cash.notes.basis,
      estimates: cash.notes.estimates,
      limits: [
        ...cash.notes.limits,
        plCarriedFrom
          ? `損益の参考試算は再計算していない（記録 ${plCarriedFrom} の値を引き継いでいる）`
          : "損益の参考試算は未計算（画面の再計算では作らない。ローカルの手動計算が必要）",
        "準備額・支払見込額は今回の計算方法（2026-11-17）のまま、freeeの最新の値で再計算している",
        ...warnings,
      ],
    },
    computeMode: opts.computeMode ?? "devRecompute",
    methodVersion: { engine: REFERENCE_FORECAST_ENGINE_VERSION, cashFlowActuals: EXTERNAL_CASH_FLOW_CALCULATION_VERSION },
    ...(opts.codeRevision ? { codeRevision: opts.codeRevision } : {}),
    bankSyncedThrough: base,
    walletableUpdateRange: inp.walletableUpdateRange,
    cashComputedAt: inp.computedAt,
    reserveComputedAt: inp.computedAt,
    ...(plCarriedFrom ? { plCarriedFrom } : {}),
    monthEndReserve,
    paymentReserve,
  };
  return { record, warnings };
}

const BONUS_ACCOUNTS = new Set(["賞与", "[製]賞与", "役員賞与"]);

/** 賞与の支給実績(振替伝票・取引の賞与関係の科目)。payment_reserve.py の bonus_actual と同じ集計 */
export function bonusActual(journals: RfManualJournal[], deals: RfDeal[], from: string, to: string) {
  let gross = 0;
  let deductions = 0;
  let net = 0;
  let payDate: string | null = null;
  for (const j of journals) {
    if (j.issueDate < from || j.issueDate > to) continue;
    if (!j.details.some((x) => BONUS_ACCOUNTS.has(x.accountName))) continue;
    for (const x of j.details) {
      if (BONUS_ACCOUNTS.has(x.accountName) && x.entrySide === "debit") gross += x.amount;
      else if (x.accountName === "預り金" && x.entrySide === "credit") deductions += x.amount;
      else if (x.accountName.includes("預金") && x.entrySide === "credit") {
        net += x.amount;
        payDate = j.issueDate;
      }
    }
  }
  for (const d of deals) {
    if (d.issueDate < from || d.issueDate > to) continue;
    if (!d.details.some((x) => BONUS_ACCOUNTS.has(x.accountName))) continue;
    for (const x of d.details) {
      if (BONUS_ACCOUNTS.has(x.accountName)) gross += x.amount;
      else if (x.accountName === "預り金") deductions += x.amount;
    }
    for (const p of d.payments) {
      net += p.amount;
      payDate = p.date;
    }
  }
  return { payDate, gross, deductions, net };
}
