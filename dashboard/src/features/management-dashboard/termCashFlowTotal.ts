import { FISCAL_MONTH_ORDER, freeeFiscalYearForTerm } from "@/config/fiscalPeriods";
import { computeMonthlyCashFlow } from "./monthlyCashFlow";
import { getJournalsCsv } from "@/services/freee/freeeJournalsClient";
import { sumInflows } from "./cashInflow";
import type { CashInflowBreakdown } from "./cashInflow";
import { sumOutflows } from "./cashOutflow";
import type { CashOutflowBreakdown } from "./cashOutflow";
import { journalExportRange, parseJournalCsv } from "./journalCsv";
import type { ExpenseCategory } from "@/config/freeeExpenseClassification";
import type { ExternalCashFlowStatus } from "./externalCashFlow";

/**
 * 期(事業期)単位の通期資金収支合計。月次スナップショット(monthlyCashFlowSnapshots、
 * MonthlyCashFlow)とは別種のデータとして扱う(ユーザー確定、2026-09-18)。
 * 「終わった期」の固定値であり、一度計算したら再計算しない(通常のページアクセスや
 * 18時の定時Jobからは触らない。過去の確定値が変わることはないため)。
 *
 * 月初現預金=期首月(9月)のcashOpening、月末現預金=期末月(8月)のcashClosing、
 * それ以外(外部入金・支出各区分・営業キャッシュ収支等)は12か月分の単純合計
 * （ユーザー確定、2026-09-18）。
 */
export interface TermCashFlowTotal {
  /** TCDの事業期番号(例: 49) */
  term: number;
  /** freeeのfiscal_year(会計年度開始の西暦年) */
  fiscalYear: number;
  cashOpening: number | null;
  cashClosing: number | null;
  cashChange: number | null;
  externalIncome: number;
  /** 12か月分の入金区分別内訳の単純合計(通期専用の別計算は無い)。v2以前の保存分には無い */
  inflow?: CashInflowBreakdown;
  /** 12か月分の出金区分別内訳の単純合計。v2以前の保存分には無い */
  outflow?: CashOutflowBreakdown;
  externalExpenseTotal: number;
  /**
   * externalIncome/externalExpenseTotal算出に使った恒久ロジックのバージョン
   * (12か月すべて同じ実行タイミングで計算するため単一の値になる)。
   */
  calculationVersion: string;
  /** 12か月のうち1か月でもprovisional(49期固有の証拠付き補完・除外の適用、または未分類あり)ならprovisional */
  status: ExternalCashFlowStatus;
  expenseByCategory: Record<ExpenseCategory, number>;
  operatingCashFlow: number;
  financingCashFlow: number;
  interestCashFlow: number;
  assetTransferCashFlow: number;
  /** 初回計算日時。このスナップショットは以後不変(再計算しない) */
  computedAt: Date;
}

const EMPTY_CATEGORY_TOTALS: Record<ExpenseCategory, number> = {
  labor: 0,
  outsourcing: 0,
  taxSocial: 0,
  financing: 0,
  interest: 0,
  assetTransfer: 0,
  otherOperating: 0,
  other: 0,
};

type MonthResult = Awaited<ReturnType<typeof computeMonthlyCashFlow>>;

export interface TermCashFlowComputation {
  total: Omit<TermCashFlowTotal, "computedAt">;
  /** 12か月分の月次結果(FISCAL_MONTH_ORDER順)。通期はこの12件の単純合計。月次スナップショットの保存にも使う */
  months: { month: number; values: MonthResult }[];
}

/**
 * 指定した事業期の12か月分をfreeeから取得・合算する。既存のcomputeMonthlyCashFlow
 * (月次資金収支)をそのまま12回呼ぶだけで、集計ロジックの新規実装は行わない
 * (ユーザー確定、2026-09-18、既存サービスの最大限再利用)。
 * termにハードコードされた前提は無く、どの期についても同じ関数で計算できる
 * (50期が終わった時点でもそのまま使える設計)。
 *
 * 入金側v3(2026-09-19): 仕訳帳のエクスポートは非同期ジョブで1回あたり数秒〜数分かかるため、
 * 前期の期首〜対象期の期末(債務の原因科目を辿る根拠を含む)を1回だけエクスポートし、各月はその伝票を日付で絞って使う
 * (通期=12か月合計という構造は変わらない。エクスポートの回数だけを減らす)。
 */
export async function computeTermCashFlow(companyId: number, term: number): Promise<TermCashFlowComputation> {
  const fiscalYear = freeeFiscalYearForTerm(term);
  const range = journalExportRange(fiscalYear);
  const journalGroups = parseJournalCsv(await getJournalsCsv(companyId, range.start, range.end));
  // 12か月分をPromise.allで並列実行すると、1か月あたり6本のfreee APIリクエストが
  // 同時に72本前後飛び、freeeのレート制限(429)に実データで抵触することを確認した
  // (2026-09-18)。この関数は「終わった期」を手動更新ボタンから稀にしか呼ばないため、
  // 実行時間が延びても逐次実行の方が安全(レート制限を踏んで丸ごと失敗する方が困る)。
  const months: TermCashFlowComputation["months"] = [];
  for (const calendarMonth of FISCAL_MONTH_ORDER) {
    months.push({
      month: calendarMonth,
      values: await computeMonthlyCashFlow(companyId, fiscalYear, calendarMonth, { journalGroups }),
    });
  }
  // FISCAL_MONTH_ORDER = [9,10,11,12,1,2,3,4,5,6,7,8] なので先頭=期首月(9月)、末尾=期末月(8月)
  const results = months.map((m) => m.values);
  const first = results[0];
  const last = results[results.length - 1];

  const sum = (get: (m: MonthResult) => number): number => results.reduce((total, m) => total + get(m), 0);

  const expenseByCategory = { ...EMPTY_CATEGORY_TOTALS };
  for (const category of Object.keys(expenseByCategory) as ExpenseCategory[]) {
    expenseByCategory[category] = sum((m) => m.expenseByCategory[category]);
  }

  const inflows = results.map((m) => m.inflow).filter((i): i is CashInflowBreakdown => i !== undefined);
  const outflows = results.map((m) => m.outflow).filter((o): o is CashOutflowBreakdown => o !== undefined);

  return {
    months,
    total: {
      term,
      fiscalYear,
      cashOpening: first.cashOpening,
      cashClosing: last.cashClosing,
      cashChange: first.cashOpening !== null && last.cashClosing !== null ? last.cashClosing - first.cashOpening : null,
      externalIncome: sum((m) => m.externalIncome),
      inflow: inflows.length === results.length ? sumInflows(inflows) : undefined,
      outflow: outflows.length === results.length ? sumOutflows(outflows) : undefined,
      externalExpenseTotal: sum((m) => m.externalExpenseTotal),
      calculationVersion: first.calculationVersion,
      status: results.some((m) => m.status === "provisional") ? "provisional" : "final",
      expenseByCategory,
      operatingCashFlow: sum((m) => m.operatingCashFlow),
      financingCashFlow: sum((m) => m.financingCashFlow),
      interestCashFlow: sum((m) => m.interestCashFlow),
      assetTransferCashFlow: sum((m) => m.assetTransferCashFlow),
    },
  };
}

/** 通期合計のみが必要な呼び出し用(computeTermCashFlowの薄いラッパー) */
export async function computeTermCashFlowTotal(
  companyId: number,
  term: number
): Promise<Omit<TermCashFlowTotal, "computedAt">> {
  return (await computeTermCashFlow(companyId, term)).total;
}
