import type {
  FreeeTrialBalanceBreakdown,
  FreeeTrialBalanceResponse,
  FreeeTrialBalanceRow,
} from "@/services/freee/freeeAccountingClient";
import { getTrialCrWithBreakdown, getTrialPlWithBreakdown } from "@/services/freee/freeeAccountingClient";
import {
  BUILDING_CANDIDATE_ACCOUNTS,
  BUILDING_ITEM_PREFIX,
  EXPENSE_CATEGORIES_CR,
  EXPENSE_CATEGORIES_PL,
  MANUFACTURING_CONSIGNMENT_ACCOUNT,
  MOTHER_PARTNER_ID,
  OUTSOURCING_ACCOUNT,
  WIP_CLOSING_ACCOUNT,
} from "@/config/performanceClassification";

/**
 * 月次業績・採算の算出方法のバージョン。保存済みドキュメントのcalculationVersionがこれと異なる場合、
 * 読み出し側は「未取得」として扱う。
 * - 1: trial_pl・trial_crを月指定(start_month=end_month)・取引先別/品目別の内訳付きで取得し、
 *      各行の「期末残高 − 期首残高」を単月値とする(ユーザー確定、2026-10-27)
 */
export const MONTHLY_PERFORMANCE_CALCULATION_VERSION = 1;

/** 建物関連費用・マザー関連支出の内訳1行(単月) */
export interface PerformanceLine {
  account: string;
  /** 品目名(建物関連費用のみ) */
  item?: string;
  amount: number;
}

/**
 * 単月の業績・採算(発生主義の損益ベース)。freeeの試算表の値をそのまま使い、取得できない行はnull。
 * 仕掛品の期首・期末調整は売上原価(当期製品製造原価)に含まれており、売上総利益に反映済み。
 */
export interface MonthlyPerformance {
  revenue: number | null;
  /** 売上総利益 = 売上高 − 売上原価(freeeの売上総損益金額) */
  grossProfit: number | null;
  /** 販管費(販売管理費の計) */
  sga: number | null;
  operatingProfit: number | null;
  nonOperatingIncome: number | null;
  nonOperatingExpense: number | null;
  ordinaryProfit: number | null;
  /** 製造労務費(製造原価報告書の労務費の計) */
  laborCost: number | null;
  /** 外注加工費([製]外注加工費。決算書と同じ範囲) */
  outsourcingCost: number | null;
  /** [製]業務委託費(外注加工費とは別項目) */
  manufacturingConsignmentCost: number | null;
  /** 建物関連費用(候補科目のうち、品目が地代・家賃と識別できるもの) */
  buildingCost: number;
  buildingLines: PerformanceLine[];
  /** 候補科目のうち品目が未選択で、建物関連費用に入れなかった金額(0なら該当なし) */
  buildingCandidateUnassigned: number;
  /** マザー関連支出(取引先がマザーの費用の合計。建物関連費用と一部重なるため合算しない) */
  motherExpense: number;
  motherLines: PerformanceLine[];
  /** その月に仕掛品振替([製]期末仕掛品の借方・貸方)の発生があったか。月次決算の確定判定ではない */
  wipTransferDetected: boolean;
}

/** Firestore(monthlyPerformanceSnapshots)へ保存する形。(fiscalYear, month)ごとに1件を上書きする */
export interface MonthlyPerformanceSnapshot extends MonthlyPerformance {
  fiscalYear: number;
  /** 暦月(1〜12) */
  month: number;
  fetchedAt: Date;
  calculationVersion: number;
}

/** 同じ月の4種類の試算表(内訳の種類違い)。合計値はどれから読んでも同じ */
export interface MonthlyTrialReports {
  plByPartner: FreeeTrialBalanceResponse;
  plByItem: FreeeTrialBalanceResponse;
  crByPartner: FreeeTrialBalanceResponse;
  crByItem: FreeeTrialBalanceResponse;
}

// 月指定で取得しても、closing_balanceは期首からその月末までの累計で返る(monthlyPl.ts参照)
function periodAmount(row: { opening_balance: number; closing_balance: number }): number {
  return row.closing_balance - row.opening_balance;
}

function subtotal(rows: FreeeTrialBalanceRow[], categoryName: string): number | null {
  const row = rows.find((b) => b.total_line === true && b.account_category_name === categoryName);
  return row ? periodAmount(row) : null;
}

function accountRow(rows: FreeeTrialBalanceRow[], accountName: string): FreeeTrialBalanceRow | null {
  return rows.find((b) => b.total_line !== true && b.account_item_name === accountName) ?? null;
}

/** 科目が試算表に無い(その期に一度も使っていない)場合は0円。区分の計が無い場合とは区別する */
function accountAmount(rows: FreeeTrialBalanceRow[], accountName: string): number {
  const row = accountRow(rows, accountName);
  return row ? periodAmount(row) : 0;
}

function buildingLines(itemRows: FreeeTrialBalanceRow[]): { lines: PerformanceLine[]; unassigned: number } {
  const lines: PerformanceLine[] = [];
  let unassigned = 0;
  for (const row of itemRows) {
    if (row.total_line === true || !row.account_item_name) continue;
    if (!BUILDING_CANDIDATE_ACCOUNTS.includes(row.account_item_name)) continue;
    for (const item of row.items ?? []) {
      const amount = periodAmount(item);
      if (amount === 0) continue;
      if (!item.id) unassigned += amount;
      else if (item.name.startsWith(BUILDING_ITEM_PREFIX)) {
        lines.push({ account: row.account_item_name, item: item.name, amount });
      }
    }
  }
  return { lines, unassigned };
}

function motherLines(partnerRows: FreeeTrialBalanceRow[], categories: readonly string[]): PerformanceLine[] {
  const lines: PerformanceLine[] = [];
  for (const row of partnerRows) {
    if (row.total_line === true || !row.account_item_name) continue;
    if (!categories.includes(row.account_category_name)) continue;
    const partner = (row.partners ?? []).find((p: FreeeTrialBalanceBreakdown) => p.id === MOTHER_PARTNER_ID);
    if (!partner) continue;
    const amount = periodAmount(partner);
    if (amount !== 0) lines.push({ account: row.account_item_name, amount });
  }
  return lines;
}

function sum(lines: PerformanceLine[]): number {
  return lines.reduce((total, line) => total + line.amount, 0);
}

/** 月指定で取得した4種類の試算表から、その月の業績・採算を取り出す */
export function extractMonthlyPerformance(reports: MonthlyTrialReports): MonthlyPerformance {
  const pl = reports.plByPartner.balances;
  const cr = reports.crByPartner.balances;
  const building = buildingLines([...reports.plByItem.balances, ...reports.crByItem.balances]);
  const mother = [
    ...motherLines(cr, EXPENSE_CATEGORIES_CR),
    ...motherLines(pl, EXPENSE_CATEGORIES_PL),
  ];
  const wipRow = accountRow(cr, WIP_CLOSING_ACCOUNT);
  return {
    revenue: subtotal(pl, "売上高"),
    grossProfit: subtotal(pl, "売上総損益金額"),
    sga: subtotal(pl, "販売管理費"),
    operatingProfit: subtotal(pl, "営業損益金額"),
    nonOperatingIncome: subtotal(pl, "営業外収益"),
    nonOperatingExpense: subtotal(pl, "営業外費用"),
    ordinaryProfit: subtotal(pl, "経常損益金額"),
    laborCost: subtotal(cr, "労務費"),
    outsourcingCost: accountAmount(cr, OUTSOURCING_ACCOUNT),
    manufacturingConsignmentCost: accountAmount(cr, MANUFACTURING_CONSIGNMENT_ACCOUNT),
    buildingCost: sum(building.lines),
    buildingLines: building.lines,
    buildingCandidateUnassigned: building.unassigned,
    motherExpense: sum(mother),
    motherLines: mother,
    wipTransferDetected: wipRow !== null && (wipRow.debit_amount !== 0 || wipRow.credit_amount !== 0),
  };
}

/**
 * freeeから指定月の業績・採算を取得する(freee APIを4回、順に呼ぶ)。fiscalYearは
 * 必ずアプリ側の事業期定義(freeeFiscalYearForTerm)から渡すこと。
 */
export async function fetchMonthlyPerformance(
  companyId: number,
  fiscalYear: number,
  month: number
): Promise<MonthlyPerformance> {
  const period = { fiscalYear, startMonth: month, endMonth: month };
  const plByPartner = await getTrialPlWithBreakdown(companyId, { ...period, breakdown: "partner" });
  const plByItem = await getTrialPlWithBreakdown(companyId, { ...period, breakdown: "item" });
  const crByPartner = await getTrialCrWithBreakdown(companyId, { ...period, breakdown: "partner" });
  const crByItem = await getTrialCrWithBreakdown(companyId, { ...period, breakdown: "item" });
  return extractMonthlyPerformance({ plByPartner, plByItem, crByPartner, crByItem });
}
