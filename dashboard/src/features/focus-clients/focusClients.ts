/**
 * 注力クライアント管理タブ(/focus-clients)の集計ロジック(純粋関数)。
 *
 * 役割分担(ユーザー確定、2026-10-30。2026-10-15の「ダッシュボード側が正」から変更):
 * - 一覧(Account.target__c=注力・掘り起こし)・会社名・区分・社内担当・テーマ・当期の目標 → Salesforce取引先(Account)
 * - 営業戦略・現在の状況・アクション・メモ・過去の期の目標 → ダッシュボード側(Firestore、Salesforceに無い情報)
 * - 案件名・金額・粗利・フェーズ・失注理由 → Salesforce案件(Process__c)
 * 会社と案件はAccount ID(Process__c.clientAccountId__c)で突合する。同名の別Accountがあるため
 * 会社名(clientName__c)では突合しない。案件が1件も無い注力クライアントも必ず表示する。
 *
 * 実績の定義は営業進捗タブ・クライアント別目標タブと同じ:
 * - 完了(主指標): 受注確度A・受注確定フェーズ・請求日が当期内
 * - 受注(先行指標): 受注確度A・受注確定フェーズ・受注日が当期内
 * 失注(フェーズ=失注)は集計から除外し、案件一覧には残す。
 */
import { fiscalMonthIndex } from "@/config/fiscalPeriods";
import type { ConcreteCrId, CrId } from "@/domain/types";

/** 期ごとの目標(円)。未入力はnull(0円目標とは区別し、達成率は「―」にする) */
export interface FocusClientTarget {
  sales: number | null;
  grossProfit: number | null;
}

/**
 * 注力クライアント1社分。Salesforce取引先の項目と、ダッシュボード側(Firestore focusClients、
 * ドキュメントID=Account ID)の項目を合わせたもの
 */
export interface FocusClientMaster {
  accountId: string;
  /** 会社名(Account.Name) */
  name: string;
  /** 注力区分(Account.target__c) */
  category: string;
  /** 注力テーマ(Account.Thema__c) */
  theme: string;
  /** 社内担当(Account.Tantosha__c のユーザー名) */
  owner: string;
  /** 社内担当の所属CR(User.Department)。CR1〜4以外・担当なしはnull */
  crId: ConcreteCrId | null;
  /** 営業戦略(比較的固定) */
  strategy: string;
  /** 現在の状況(随時更新) */
  currentStatus: string;
  /** 今月のアクション */
  monthAction: string;
  /** 次回アクション */
  nextAction: string;
  /** 一覧に表示するメモ(ユーザー指示、2026-10-19) */
  memo: string;
  /** メモ専用の最終更新(他項目の保存では変わらない) */
  memoUpdatedBy: string | null;
  memoUpdatedAt: string | null;
  /** 事業期番号(文字列)→目標。当期はSalesforce取引先の目標、過去の期はダッシュボードに保存した目標 */
  targets: Record<string, FocusClientTarget>;
  updatedBy: string | null;
  updatedAt: string | null;
}

/** ダッシュボード側(Firestore)で編集する項目。保存APIの応答から画面へ反映するのはこれらだけ */
export const DASHBOARD_FIELDS = [
  "strategy",
  "currentStatus",
  "monthAction",
  "nextAction",
  "memo",
  "memoUpdatedBy",
  "memoUpdatedAt",
  "updatedBy",
  "updatedAt",
] as const satisfies readonly (keyof FocusClientMaster)[];

/** 保存APIの応答のうち画面へ反映する部分 */
export type FocusClientSavedFields = Pick<FocusClientMaster, "accountId" | (typeof DASHBOARD_FIELDS)[number]>;

/** 保存結果のうちダッシュボード側の項目だけを反映する(会社名・担当・目標はSalesforceの値を保つ) */
export function applySavedFields(current: FocusClientMaster, saved: FocusClientSavedFields): FocusClientMaster {
  const next = { ...current };
  for (const key of DASHBOARD_FIELDS) (next as Record<string, unknown>)[key] = saved[key];
  return next;
}

/** 全社(ALL)・CR別の年間目標粗利(SalesTarget__c)。未設定はnull */
export type ScopeTargets = Record<CrId, number | null>;

export type DealStatus = "open" | "won" | "lost";

/** 注力クライアントの案件1件(Process__c) */
export interface FocusDeal {
  id: string;
  accountId: string;
  name: string;
  phase: string | null;
  confidence: string | null;
  crId: ConcreteCrId | null;
  salesRep: string | null;
  sales: number | null;
  grossProfit: number | null;
  orderDate: string | null;
  invoiceDate: string | null;
  plannedSalesDate: string | null;
  lostReason: string | null;
}

export const CONFIRMED_PHASES = ["受注", "納品", "請求", "入金"] as const;
export const OPEN_PHASES = ["提案", "見積"] as const;
export const LOST_PHASE = "失注";
export const CONFIDENCE_A = "A (80～100%)";

export function dealStatus(deal: Pick<FocusDeal, "phase">): DealStatus {
  if (deal.phase === LOST_PHASE) return "lost";
  if ((CONFIRMED_PHASES as readonly (string | null)[]).includes(deal.phase)) return "won";
  return "open";
}

/** 実績(完了・受注)に数える案件か。営業進捗タブの受注確定条件と同じ */
function isConfirmedA(deal: FocusDeal): boolean {
  return dealStatus(deal) === "won" && deal.confidence === CONFIDENCE_A;
}

export interface FocusClientRow {
  master: FocusClientMaster;
  target: FocusClientTarget;
  /** 累計完了(期首〜当月、請求日基準) */
  completedSalesToDate: number;
  completedGrossProfitToDate: number;
  /** 通年完了予定(当期全月、当月より先の請求予定を含む) */
  completedSalesFullYear: number;
  completedGrossProfitFullYear: number;
  /** 累計受注(期首〜当月、受注日基準) */
  orderSalesToDate: number;
  orderGrossProfitToDate: number;
  /** 年間達成率(%) = 累計完了 ÷ 年間目標。目標未入力・0円はnull */
  salesRate: number | null;
  grossProfitRate: number | null;
  /** 通年達成率(%) = 通年完了予定 ÷ 年間目標。一覧・サマリーはこちらを表示する(ユーザー指示、2026-10-19) */
  grossProfitRateFullYear: number | null;
  openCount: number;
  openSales: number;
  openGrossProfit: number;
  lostCount: number;
  /** 案件一覧(当期分。失注も含む) */
  deals: FocusDeal[];
}

export interface FocusClientSummary {
  clientCount: number;
  /** 目標(粗利)が入力済みの社数 */
  targetedCount: number;
  targetSales: number;
  targetGrossProfit: number;
  completedSalesToDate: number;
  completedGrossProfitToDate: number;
  completedGrossProfitFullYear: number;
  orderGrossProfitToDate: number;
  /** 目標入力済みの社だけで計算した達成率(未入力社の実績を分子に混ぜない) */
  salesRate: number | null;
  grossProfitRate: number | null;
  grossProfitRateFullYear: number | null;
  openCount: number;
  openGrossProfit: number;
  lostCount: number;
}

export interface FocusClientsResult {
  rows: FocusClientRow[];
  summary: FocusClientSummary;
}

const EMPTY_TARGET: FocusClientTarget = { sales: null, grossProfit: null };

function rate(actual: number, target: number | null): number | null {
  if (target === null || target === 0) return null;
  return Math.round((actual / target) * 1000) / 10;
}

/** 日付(YYYY-MM-DD)が当期内で、期首〜当月の範囲に入るか */
function isWithin(date: string | null, range: { start: string; end: string }): date is string {
  return date !== null && date >= range.start && date <= range.end;
}

function isToDate(date: string, currentMonth: number): boolean {
  return fiscalMonthIndex(Number(date.slice(5, 7))) <= fiscalMonthIndex(currentMonth);
}

/** 案件一覧の並び: 進行中→受注以降→失注、各グループ内は日付の新しい順 */
const STATUS_ORDER: Record<DealStatus, number> = { open: 0, won: 1, lost: 2 };

function dealSortDate(deal: FocusDeal): string {
  return deal.invoiceDate ?? deal.orderDate ?? deal.plannedSalesDate ?? "";
}

export function compareDeals(a: FocusDeal, b: FocusDeal): number {
  const byStatus = STATUS_ORDER[dealStatus(a)] - STATUS_ORDER[dealStatus(b)];
  if (byStatus !== 0) return byStatus;
  return dealSortDate(b).localeCompare(dealSortDate(a));
}

export interface ComputeFocusClientsInput {
  term: number;
  /** 当期の期首・期末(YYYY-MM-DD) */
  termRange: { start: string; end: string };
  /** 累計の締め月(暦月)。今期は当月、過去の期は期末月 */
  currentMonth: number;
  masters: FocusClientMaster[];
  deals: FocusDeal[];
}

export function computeFocusClients(input: ComputeFocusClientsInput): FocusClientsResult {
  const { term, termRange, currentMonth } = input;
  const dealsByAccount = new Map<string, FocusDeal[]>();
  // 案件ID単位で重複排除(SOQLのOR条件で同じ案件が複数回返ることは無いが、念のため)
  const seen = new Set<string>();
  for (const deal of input.deals) {
    if (seen.has(deal.id)) continue;
    seen.add(deal.id);
    const list = dealsByAccount.get(deal.accountId) ?? [];
    list.push(deal);
    dealsByAccount.set(deal.accountId, list);
  }

  const rows: FocusClientRow[] = input.masters.map((master) => {
    const deals = (dealsByAccount.get(master.accountId) ?? []).slice().sort(compareDeals);
    const target = master.targets[String(term)] ?? EMPTY_TARGET;
    const row: FocusClientRow = {
      master,
      target,
      completedSalesToDate: 0,
      completedGrossProfitToDate: 0,
      completedSalesFullYear: 0,
      completedGrossProfitFullYear: 0,
      orderSalesToDate: 0,
      orderGrossProfitToDate: 0,
      salesRate: null,
      grossProfitRate: null,
      grossProfitRateFullYear: null,
      openCount: 0,
      openSales: 0,
      openGrossProfit: 0,
      lostCount: 0,
      deals,
    };
    for (const deal of deals) {
      const status = dealStatus(deal);
      const sales = deal.sales ?? 0;
      const grossProfit = deal.grossProfit ?? 0;
      if (status === "lost") {
        row.lostCount += 1;
        continue;
      }
      if (status === "open") {
        row.openCount += 1;
        row.openSales += sales;
        row.openGrossProfit += grossProfit;
        continue;
      }
      if (!isConfirmedA(deal)) continue;
      if (isWithin(deal.invoiceDate, termRange)) {
        row.completedSalesFullYear += sales;
        row.completedGrossProfitFullYear += grossProfit;
        if (isToDate(deal.invoiceDate, currentMonth)) {
          row.completedSalesToDate += sales;
          row.completedGrossProfitToDate += grossProfit;
        }
      }
      if (isWithin(deal.orderDate, termRange) && isToDate(deal.orderDate, currentMonth)) {
        row.orderSalesToDate += sales;
        row.orderGrossProfitToDate += grossProfit;
      }
    }
    row.salesRate = rate(row.completedSalesToDate, target.sales);
    row.grossProfitRate = rate(row.completedGrossProfitToDate, target.grossProfit);
    row.grossProfitRateFullYear = rate(row.completedGrossProfitFullYear, target.grossProfit);
    return row;
  });

  return { rows, summary: summarize(rows) };
}

function summarize(rows: FocusClientRow[]): FocusClientSummary {
  let targetSales = 0;
  let targetGrossProfit = 0;
  let salesActualForRate = 0;
  let grossProfitActualForRate = 0;
  let grossProfitFullYearForRate = 0;
  let targetedCount = 0;
  const summary = {
    completedSalesToDate: 0,
    completedGrossProfitToDate: 0,
    completedGrossProfitFullYear: 0,
    orderGrossProfitToDate: 0,
    openCount: 0,
    openGrossProfit: 0,
    lostCount: 0,
  };
  for (const row of rows) {
    if (row.target.sales) {
      targetSales += row.target.sales;
      salesActualForRate += row.completedSalesToDate;
    }
    if (row.target.grossProfit) {
      targetedCount += 1;
      targetGrossProfit += row.target.grossProfit;
      grossProfitActualForRate += row.completedGrossProfitToDate;
      grossProfitFullYearForRate += row.completedGrossProfitFullYear;
    }
    summary.completedSalesToDate += row.completedSalesToDate;
    summary.completedGrossProfitToDate += row.completedGrossProfitToDate;
    summary.completedGrossProfitFullYear += row.completedGrossProfitFullYear;
    summary.orderGrossProfitToDate += row.orderGrossProfitToDate;
    summary.openCount += row.openCount;
    summary.openGrossProfit += row.openGrossProfit;
    summary.lostCount += row.lostCount;
  }
  return {
    clientCount: rows.length,
    targetedCount,
    targetSales,
    targetGrossProfit,
    ...summary,
    salesRate: rate(salesActualForRate, targetSales || null),
    grossProfitRate: rate(grossProfitActualForRate, targetGrossProfit || null),
    grossProfitRateFullYear: rate(grossProfitFullYearForRate, targetGrossProfit || null),
  };
}

/**
 * 一覧の区分グループ。常に注力を上、掘り起こしを下にまとめ、並び替えはグループ内で行う
 * (ユーザー指示、2026-10-19)。それ以外・未入力の区分は最下部。
 */
export function categoryGroup(category: string): number {
  if (category === "注力") return 0;
  if (category === "掘り起こし") return 1;
  return 2;
}
