import { REFERENCE_FORECAST_SCHEMA_VERSION, type ReferenceForecastRecord } from "../referenceForecast";
import { addMonths } from "./calendar";
import { computeCash } from "./cashEngine";
import { computeReserves } from "./reserve";
import { matchSales } from "./salesMatching";
import type { RfDeal, RfInputs, RfManualJournal } from "./types";

/**
 * DEVの再計算(2026-11-18)。集めた入力から、資金予測・入金照合・準備額・支払見込額を計算して1件の記録にする。
 * 損益(pl)は再計算せず、直前の記録の値を引き継ぐ(plCarriedFrom に元の記録ID)。
 */
export function buildReferenceForecastRecord(
  inp: RfInputs,
  opts: { createdBy: string; codeCommit: string; previous: ReferenceForecastRecord | null }
): { record: ReferenceForecastRecord; warnings: string[] } {
  const base = inp.bankSyncedThrough;
  const M = base.slice(0, 7);
  const { events, summary } = matchSales(inp.sfProcesses, inp.incomeDeals, inp.partners, base, `${addMonths(M, -1)}-01`, `${addMonths(M, -2)}-01`);
  const cash = computeCash(inp, events);
  const { monthEndReserve, paymentReserve, warnings } = computeReserves(inp);
  const stamp = inp.computedAt.slice(0, 19).replace(/[-:]/g, "");
  const prev = opts.previous;
  const plCarriedFrom = prev ? (prev.plCarriedFrom ?? prev.carriedFrom ?? prev.derivedFrom ?? prev.id) : null;
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
    pl: prev?.pl ?? { scenarios: [] },
    notes: {
      basis: cash.notes.basis,
      estimates: cash.notes.estimates,
      limits: [
        ...cash.notes.limits,
        prev
          ? `損益の参考試算は再計算していない（記録 ${plCarriedFrom} の値を引き継いでいる）`
          : "損益の参考試算は再計算していない",
        "準備額・支払見込額は今回の計算方法（2026-11-17）のまま、freeeの最新の値で再計算している",
        ...warnings,
      ],
    },
    computeMode: "devRecompute",
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
