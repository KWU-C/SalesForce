import { getFreeeCompanyId } from "@/repositories/freeeAuthRepository";
import { getSalesforceJwtConfig } from "@/config/salesforce";
import { SalesforceClient, type SalesforceQueryClient } from "@/services/salesforce/salesforceClient";
import {
  getRfBonusMonth,
  getRfPayrollMonth,
  getRfTrialBs,
  listRfAccountItems,
  listRfDeals,
  listRfManualJournals,
  listRfPartners,
  listRfTransfers,
  listRfWalletables,
  listRfWalletTxns,
} from "@/services/freee/freeeReferenceForecastClient";
import type { ForecastClientDeps } from "@/services/freee/freeeForecastClient";
import { addMonths, fiscalYearOf, lastDayOfMonth, ym } from "./calendar";
import { bonusActual } from "./buildRecord";
import { bonusPlan } from "./reserve";
import type { RfInputs, RfSfCost, RfSfProcess } from "./types";

/**
 * DEVの再計算の入力を freee・Salesforce から集める(2026-11-18)。読み取りのみ。
 * 基準日 = 銀行明細の最終日(連携口座の明細がある最後の日、今日まで)。
 */

function jstNow(now: Date): { iso: string; date: string } {
  const j = new Date(now.getTime() + 9 * 3600 * 1000);
  const iso = `${j.toISOString().slice(0, 19)}+09:00`;
  return { iso, date: iso.slice(0, 10) };
}

export interface CollectDeps {
  now?: () => Date;
  freee?: ForecastClientDeps;
  getCompanyId?: () => Promise<number | null>;
  salesforce?: SalesforceQueryClient;
}

export class ReferenceForecastInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReferenceForecastInputError";
  }
}

export async function collectReferenceForecastInputs(deps: CollectDeps = {}): Promise<RfInputs> {
  const { iso: computedAt, date: today } = jstNow((deps.now ?? (() => new Date()))());
  const companyId = await (deps.getCompanyId ?? getFreeeCompanyId)();
  if (companyId === null) throw new ReferenceForecastInputError("freeeに接続されていません");
  const f = deps.freee ?? {};
  const todayMonth = ym(today);

  const accountItems = await listRfAccountItems(companyId, f);
  const names = new Map(accountItems.map((a) => [a.id, a.name]));
  const idOf = (name: string) => accountItems.find((a) => a.name === name)?.id;
  const walletables = await listRfWalletables(companyId, f);
  const txnFrom = `${addMonths(todayMonth, -13)}-01`;
  const txnTo = lastDayOfMonth(addMonths(todayMonth, 1));
  const walletTxns = await listRfWalletTxns(companyId, txnFrom, txnTo, f);
  const bankDates = walletTxns.filter((t) => t.walletableType === "bank_account" && t.date <= today).map((t) => t.date);
  if (bankDates.length === 0) throw new ReferenceForecastInputError("銀行明細がありません");
  const base = bankDates.sort().at(-1) as string;
  const M = ym(base);
  const N = addMonths(M, 1);
  const H = [addMonths(M, -3), addMonths(M, -2), addMonths(M, -1)];
  const fy = fiscalYearOf(M);
  const bankUpdates = walletables.filter((w) => w.type === "bank_account" && w.updateDate).map((w) => w.updateDate as string).sort();

  const transfers = await listRfTransfers(companyId, txnFrom, txnTo, f);
  const partners = await listRfPartners(companyId, f);
  const incomeDeals = await listRfDeals(companyId, { type: "income", startIssueDate: `${addMonths(M, -10)}-01` }, names, f);
  const expenseDeals = await listRfDeals(companyId, { type: "expense", startIssueDate: `${addMonths(M, -13)}-01` }, names, f);

  const payrollMonths = [...new Set([...H, M, N, addMonths(N, -12)])];
  const payroll: RfInputs["payroll"] = {};
  for (const m of payrollMonths) payroll[m] = await getRfPayrollMonth(companyId, m, f);
  const plan = bonusPlan(M);
  const bonus: RfInputs["bonus"] = {};
  for (const m of [...new Set([M, N, plan.nextMonth])]) bonus[m] = await getRfBonusMonth(companyId, m, f);
  const bonusHistory: RfInputs["bonusHistory"] = {};
  for (const m of [...new Set([plan.prevSameMonth, plan.lastMonth, addMonths(M, -12), addMonths(N, -12)])]) {
    const from = `${m}-01`;
    const to = `${m}-20`;
    const journals = await listRfManualJournals(companyId, { startIssueDate: from, endIssueDate: to }, names, f);
    bonusHistory[m] = bonusActual(journals, expenseDeals, from, to);
  }

  // 基準日の現金・預金の残高(試算表、期首〜基準日)
  const bs = await getRfTrialBs(companyId, { startDate: `${fy}-09-01`, endDate: base }, false, f);
  const baseBalances = { checking: 0, timeDeposit: 0, cash: 0 };
  for (const b of bs) {
    if (b.categoryName !== "現金・預金") continue;
    if (b.accountName.startsWith("定期")) baseBalances.timeDeposit += b.closing;
    else if (b.accountName.includes("現金")) baseBalances.cash += b.closing;
    else baseBalances.checking += b.closing;
  }

  // 準備額・支払見込額
  const trialBsByMonth: RfInputs["reserve"]["trialBsByMonth"] = {};
  for (const m of [addMonths(M, -2), addMonths(M, -1), M]) {
    trialBsByMonth[m] = await getRfTrialBs(companyId, { fiscalYear: fiscalYearOf(m), endMonth: Number(m.slice(5, 7)) }, true, f);
  }
  const since = `${fy - 1}-09-01`;
  const prevEnd = `${fy}-08-31`;
  const provisionalId = idOf("仮払税金");
  const payableId = idOf("未払消費税等");
  const receivedId = idOf("仮受消費税");
  const provisionalTaxDeals = provisionalId ? await listRfDeals(companyId, { type: "expense", startIssueDate: since, accountItemId: provisionalId }, names, f) : [];
  const consumptionTaxPayableDeals = payableId ? await listRfDeals(companyId, { type: "expense", startIssueDate: since, accountItemId: payableId }, names, f) : [];
  const consumptionTaxPayableJournals = payableId ? await listRfManualJournals(companyId, { startIssueDate: since, accountItemId: payableId }, names, f) : [];
  const closingJournals = receivedId ? await listRfManualJournals(companyId, { startIssueDate: prevEnd, endIssueDate: prevEnd, accountItemId: receivedId }, names, f) : [];

  // Salesforce
  const sf = deps.salesforce ?? new SalesforceClient(getSalesforceJwtConfig());
  const sinceBilled = `${addMonths(M, -1)}-01`;
  const processes = await sf.query<{
    Id: string;
    phase__c: string | null;
    juchukakudo__c: string | null;
    seikyuubi__c: string | null;
    nyuukin_yoteibi__c: string | null;
    uriage_tax__c: number | null;
    seikyuusakimei__r: { Name: string | null } | null;
  }>(
    `SELECT Id, phase__c, juchukakudo__c, seikyuubi__c, nyuukin_yoteibi__c, uriage_tax__c, seikyuusakimei__r.Name FROM Process__c WHERE seikyuubi__c >= ${sinceBilled}`
  );
  // 原価(Cost__c)は慎重ケースの未登録外注にだけ使う。読めない(権限不足・取得失敗)ときは止めずに null(未取得。0円ではない)にし、慎重ケースに含められていない支出として示す
  type CostRow = { shiirebi__c: string | null; zeikomikingaku__c: number | null; shiharaisakimei__r: { Name: string | null } | null };
  let costs: CostRow[] | null = null;
  try {
    costs = await sf.query<CostRow>(
      `SELECT shiirebi__c, zeikomikingaku__c, shiharaisakimei__r.Name FROM Cost__c WHERE shiirebi__c >= ${addMonths(M, -1)}-01 AND shiirebi__c <= ${lastDayOfMonth(addMonths(M, -1))}`
    );
  } catch {
    costs = null;
  }
  const sfProcesses: RfSfProcess[] = processes.map((r) => ({
    id: r.Id,
    phase: r.phase__c ?? "",
    probability: r.juchukakudo__c ?? "",
    billedDate: r.seikyuubi__c,
    plannedReceiptDate: r.nyuukin_yoteibi__c,
    amountTaxIncluded: r.uriage_tax__c ?? 0,
    billToName: r.seikyuusakimei__r?.Name ?? "",
  }));
  const sfCosts: RfSfCost[] | null = costs === null ? null : costs.map((r) => ({ purchaseDate: r.shiirebi__c, amountTaxIncluded: r.zeikomikingaku__c ?? 0, vendorName: r.shiharaisakimei__r?.Name ?? "" }));

  return {
    computedAt,
    bankSyncedThrough: base,
    walletableUpdateRange: { min: bankUpdates[0] ?? null, max: bankUpdates.at(-1) ?? null },
    baseBalances,
    partners,
    walletables,
    walletTxns,
    transfers,
    incomeDeals,
    expenseDeals,
    payroll,
    bonus,
    bonusHistory,
    sfProcesses,
    sfCosts,
    reserve: { trialBsByMonth, provisionalTaxDeals, consumptionTaxPayableDeals, consumptionTaxPayableJournals, closingJournals },
  };
}
