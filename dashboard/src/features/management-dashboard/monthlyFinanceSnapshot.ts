import type { FreeeTrialBalanceResponse, FreeeTrialBalanceRow } from "@/services/freee/freeeAccountingClient";
import { getTrialBs, getTrialPl } from "@/services/freee/freeeAccountingClient";
import { classifyOutputCostAccountItem } from "@/config/freeeOutputClassification";
import type { MonthlyFinanceSnapshot } from "./types";

type MonthlyPlPart = Pick<
  MonthlyFinanceSnapshot,
  | "sales"
  | "grossProfit"
  | "grossMargin"
  | "operatingProfit"
  | "operatingMargin"
  | "ordinaryProfit"
  | "laborCost"
  | "outsourcingCost"
  | "otherSga"
>;

type MonthlyBsPart = Pick<
  MonthlyFinanceSnapshot,
  "cashOpening" | "cashClosing" | "cashChange" | "accountsReceivable" | "accountsPayable" | "unpaidExpenses" | "borrowings"
>;

// trial_pl/trial_bsのclosing_balanceは常に会計年度開始からの累計値を返す
// (freeeの仕様、実データで確認済み、2026-09-14)。start_month=end_month=対象月で
// 問い合わせたopening_balanceは「対象月の直前までの累計値」を正しく返すため、
// closing - opening が単月の値になる。前月分を別途取得する必要はない。
function monthDelta(row: FreeeTrialBalanceRow | null): number | null {
  if (!row) return null;
  return row.closing_balance - row.opening_balance;
}

function findTotalLineRow(balances: FreeeTrialBalanceRow[], categoryName: string): FreeeTrialBalanceRow | null {
  return balances.find((b) => b.total_line === true && b.account_category_name === categoryName) ?? null;
}

function findLeafRow(balances: FreeeTrialBalanceRow[], accountItemName: string): FreeeTrialBalanceRow | null {
  return balances.find((b) => b.account_item_name === accountItemName) ?? null;
}

function sumLeafClosingBalances(balances: FreeeTrialBalanceRow[], accountItemNames: string[]): number | null {
  const rows = accountItemNames
    .map((name) => findLeafRow(balances, name))
    .filter((row): row is FreeeTrialBalanceRow => row !== null);
  if (rows.length === 0) return null;
  return rows.reduce((sum, row) => sum + row.closing_balance, 0);
}

/** 小数1桁に丸めたパーセント。分母が0またはどちらかがnullならnull(0%と推測しない) */
function safeRate(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator === 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

export function extractMonthlyPl(trialPl: FreeeTrialBalanceResponse): MonthlyPlPart {
  const sales = monthDelta(findTotalLineRow(trialPl.balances, "売上高"));
  const grossProfit = monthDelta(findTotalLineRow(trialPl.balances, "売上総損益金額"));
  const operatingProfit = monthDelta(findTotalLineRow(trialPl.balances, "営業損益金額"));
  const ordinaryProfit = monthDelta(findTotalLineRow(trialPl.balances, "経常損益金額"));

  // 販売管理費配下の各勘定科目を単月の値(closing-opening)へ変換してから、
  // 設定(freeeOutputClassification)に従って労務費/外注費/その他販管費へ再分類する
  let laborCost = 0;
  let outsourcingCost = 0;
  let otherSga = 0;
  let foundAnySga = false;
  for (const row of trialPl.balances) {
    if (row.account_category_name !== "販売管理費" || !row.account_item_name) continue;
    foundAnySga = true;
    const value = row.closing_balance - row.opening_balance;
    const category = classifyOutputCostAccountItem(row.account_item_name);
    if (category === "labor") laborCost += value;
    else if (category === "outsourcing") outsourcingCost += value;
    else otherSga += value;
  }

  return {
    sales,
    grossProfit,
    grossMargin: safeRate(grossProfit, sales),
    operatingProfit,
    operatingMargin: safeRate(operatingProfit, sales),
    ordinaryProfit,
    laborCost: foundAnySga ? laborCost : null,
    outsourcingCost: foundAnySga ? outsourcingCost : null,
    otherSga: foundAnySga ? otherSga : null,
  };
}

export function extractMonthlyBs(trialBs: FreeeTrialBalanceResponse): MonthlyBsPart {
  // 「現金・預金」はfreee側に合算済みの小計行が無く、口座ごとのleaf行しか
  // 返らないため、Dashboard側で合算する(実データで確認済み、2026-09-14)
  const cashLeaves = trialBs.balances.filter(
    (b) => b.account_category_name === "現金・預金" && !!b.account_item_name
  );
  const cashOpening = cashLeaves.length > 0 ? cashLeaves.reduce((sum, b) => sum + b.opening_balance, 0) : null;
  const cashClosing = cashLeaves.length > 0 ? cashLeaves.reduce((sum, b) => sum + b.closing_balance, 0) : null;
  const cashChange = cashOpening !== null && cashClosing !== null ? cashClosing - cashOpening : null;

  return {
    cashOpening,
    cashClosing,
    cashChange,
    accountsReceivable: findLeafRow(trialBs.balances, "売掛金")?.closing_balance ?? null,
    accountsPayable: findLeafRow(trialBs.balances, "買掛金")?.closing_balance ?? null,
    unpaidExpenses: findLeafRow(trialBs.balances, "未払金")?.closing_balance ?? null,
    borrowings: sumLeafClosingBalances(trialBs.balances, ["短期借入金", "長期借入金", "役員借入金"]),
  };
}

/**
 * 指定した単月(fiscalYear基準の暦月)の経営数値をfreeeから取得する。
 * trial_pl・trial_bsそれぞれ1回の呼び出しで完結する(前月分の別呼び出しは不要、
 * closing_balance-opening_balanceの差分で単月化しているため)。
 */
export async function fetchMonthlyFinanceFromFreee(
  companyId: number,
  fiscalYear: number,
  calendarMonth: number
): Promise<MonthlyPlPart & MonthlyBsPart> {
  const [trialPl, trialBs] = await Promise.all([
    getTrialPl(companyId, { fiscalYear, startMonth: calendarMonth, endMonth: calendarMonth }),
    getTrialBs(companyId, { fiscalYear, startMonth: calendarMonth, endMonth: calendarMonth }),
  ]);
  return {
    ...extractMonthlyPl(trialPl),
    ...extractMonthlyBs(trialBs),
  };
}
