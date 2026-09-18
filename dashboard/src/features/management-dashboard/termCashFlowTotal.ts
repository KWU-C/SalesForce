import { FISCAL_MONTH_ORDER, freeeFiscalYearForTerm } from "@/config/fiscalPeriods";
import { computeMonthlyCashFlow } from "./monthlyCashFlow";
import type { ExpenseCategory } from "@/config/freeeExpenseClassification";
import type { ExternalCashFlowOverride, UnresolvedCashFlowItem } from "@/config/externalCashFlowOverrides";
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
  externalExpenseTotal: number;
  /**
   * externalIncome/externalExpenseTotal算出に使った恒久ロジックのバージョン
   * (12か月すべて同じ実行タイミングで計算するため単一の値になる)。
   */
  calculationVersion: string;
  /** 12か月のうち1か月でもprovisional(override適用・未解決明細ありなど)を含めばprovisional */
  status: ExternalCashFlowStatus;
  /** 12か月分の適用overrideIDをまとめたもの(監査用) */
  appliedOverrideIds: string[];
  /** 12か月分の未解決明細をまとめたもの(控除していない) */
  unresolvedItems: UnresolvedCashFlowItem[];
  /** 12か月分のtentative候補をまとめたもの(控除していない) */
  tentativeCandidates: ExternalCashFlowOverride[];
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

/**
 * 指定した事業期の12か月分をfreeeから取得・合算する。既存のcomputeMonthlyCashFlow
 * (月次資金収支)をそのまま12回呼ぶだけで、freee APIへの新規アクセス・集計ロジックの
 * 新規実装は行わない(ユーザー確定、2026-09-18、既存サービスの最大限再利用)。
 * termにハードコードされた前提は無く、どの期についても同じ関数で計算できる
 * (50期が終わった時点でもそのまま使える設計)。
 */
export async function computeTermCashFlowTotal(
  companyId: number,
  term: number
): Promise<Omit<TermCashFlowTotal, "computedAt">> {
  const fiscalYear = freeeFiscalYearForTerm(term);
  // 12か月分をPromise.allで並列実行すると、1か月あたり6本のfreee APIリクエストが
  // 同時に72本前後飛び、freeeのレート制限(429)に実データで抵触することを確認した
  // (2026-09-18)。この関数は「終わった期」を手動更新ボタンから稀にしか呼ばないため、
  // 実行時間が延びても逐次実行の方が安全(レート制限を踏んで丸ごと失敗する方が困る)。
  const months: Awaited<ReturnType<typeof computeMonthlyCashFlow>>[] = [];
  for (const calendarMonth of FISCAL_MONTH_ORDER) {
    months.push(await computeMonthlyCashFlow(companyId, fiscalYear, calendarMonth));
  }
  // FISCAL_MONTH_ORDER = [9,10,11,12,1,2,3,4,5,6,7,8] なので先頭=期首月(9月)、末尾=期末月(8月)
  const first = months[0];
  const last = months[months.length - 1];

  const sum = (get: (m: (typeof months)[number]) => number): number => months.reduce((total, m) => total + get(m), 0);

  const expenseByCategory = { ...EMPTY_CATEGORY_TOTALS };
  for (const category of Object.keys(expenseByCategory) as ExpenseCategory[]) {
    expenseByCategory[category] = sum((m) => m.expenseByCategory[category]);
  }

  return {
    term,
    fiscalYear,
    cashOpening: first.cashOpening,
    cashClosing: last.cashClosing,
    cashChange: first.cashOpening !== null && last.cashClosing !== null ? last.cashClosing - first.cashOpening : null,
    externalIncome: sum((m) => m.externalIncome),
    externalExpenseTotal: sum((m) => m.externalExpenseTotal),
    calculationVersion: first.calculationVersion,
    status: months.some((m) => m.status === "provisional") ? "provisional" : "final",
    appliedOverrideIds: months.flatMap((m) => m.appliedOverrideIds),
    unresolvedItems: months.flatMap((m) => m.unresolvedItems),
    tentativeCandidates: months.flatMap((m) => m.tentativeCandidates),
    expenseByCategory,
    operatingCashFlow: sum((m) => m.operatingCashFlow),
    financingCashFlow: sum((m) => m.financingCashFlow),
    interestCashFlow: sum((m) => m.interestCashFlow),
    assetTransferCashFlow: sum((m) => m.assetTransferCashFlow),
  };
}
