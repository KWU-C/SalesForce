import { CONCRETE_CR_IDS, isConcreteCrId } from "@/domain/types";
import { fiscalTermDateRange } from "@/config/fiscalPeriods";
import { getSalesforceJwtConfig } from "@/config/salesforce";
import { SalesforceClient } from "@/services/salesforce/salesforceClient";
import type { SalesforceQueryClient } from "@/services/salesforce/salesforceClient";
import { buildFocusAccountsQuery, buildFocusClientDealsQuery } from "@/services/salesforce/focusClientQueries";
import { buildSalesTargetQuery } from "@/services/salesforce/salesforceQueries";
import type { FocusClientMaster, FocusDeal, ScopeTargets } from "@/features/focus-clients/focusClients";
import { getFocusClientDashboardFields } from "./focusClientMasterRepository";
import type { FocusClientDashboardFields } from "./focusClientMasterRepository";

/** 明細取得(非集計)クエリのため、生のAPI名のまま返ってくる */
interface RawDealRow {
  Id: string;
  Name: string | null;
  clientAccountId__c: string | null;
  phase__c: string | null;
  juchukakudo__c: string | null;
  bumonna__c: string | null;
  eigyoutantousha__r: { Name: string | null } | null;
  uriagegoukei__c: number | null;
  arari__c: number | null;
  juchuubi__c: string | null;
  seikyuubi__c: string | null;
  uriageyoteibi__c: string | null;
  shicchu_riyu__c: string | null;
}

export interface RawFocusAccountRow {
  Id: string;
  Name: string | null;
  target__c: string | null;
  Tantosha__r: { Name: string | null; Department: string | null } | null;
  Thema__c: string | null;
  mokuhyouuriage_eigyou__c: number | null;
  mokuhyouarari_eigyou__c: number | null;
}

const EMPTY_DASHBOARD_FIELDS: Omit<FocusClientDashboardFields, "accountId"> = {
  strategy: "",
  currentStatus: "",
  monthAction: "",
  nextAction: "",
  memo: "",
  memoUpdatedBy: null,
  memoUpdatedAt: null,
  targets: {},
  updatedBy: null,
  updatedAt: null,
};

/**
 * Salesforce取引先とダッシュボード側の項目を合わせる。一覧はSalesforceの取引先だけで決まり、
 * ダッシュボード側にしか無い社は出さない。取引先の目標は期を持たないため当期の目標とし
 * (ユーザー確定 2026-10-30)、過去の期はダッシュボードに保存した目標を使う。並びは名称順。
 */
export function mergeFocusClients(
  accounts: RawFocusAccountRow[],
  dashboardFields: Map<string, FocusClientDashboardFields>,
  currentTerm: number
): FocusClientMaster[] {
  return accounts
    .map((account) => {
      const saved = dashboardFields.get(account.Id) ?? { accountId: account.Id, ...EMPTY_DASHBOARD_FIELDS };
      const department = account.Tantosha__r?.Department ?? null;
      return {
        ...saved,
        accountId: account.Id,
        name: account.Name ?? "",
        category: account.target__c ?? "",
        theme: account.Thema__c ?? "",
        owner: account.Tantosha__r?.Name ?? "",
        crId: isConcreteCrId(department) ? department : null,
        targets: {
          ...saved.targets,
          [String(currentTerm)]: { sales: account.mokuhyouuriage_eigyou__c, grossProfit: account.mokuhyouarari_eigyou__c },
        },
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "ja"));
}

type SalesTargetRow = { TargetGrossProfit__c?: number | null } & Partial<
  Record<`CR${1 | 2 | 3 | 4}TargetGrossProfit__c`, number | null>
>;

export function toScopeTargets(row: SalesTargetRow | undefined): ScopeTargets {
  const result = { ALL: row?.TargetGrossProfit__c ?? null } as ScopeTargets;
  for (const crId of CONCRETE_CR_IDS) result[crId] = row?.[`${crId}TargetGrossProfit__c`] ?? null;
  return result;
}

function toDeal(row: RawDealRow): FocusDeal | null {
  if (!row.clientAccountId__c) return null;
  return {
    id: row.Id,
    accountId: row.clientAccountId__c,
    name: row.Name ?? "",
    phase: row.phase__c,
    confidence: row.juchukakudo__c,
    crId: isConcreteCrId(row.bumonna__c) ? row.bumonna__c : null,
    salesRep: row.eigyoutantousha__r?.Name ?? null,
    sales: row.uriagegoukei__c,
    grossProfit: row.arari__c,
    orderDate: row.juchuubi__c,
    invoiceDate: row.seikyuubi__c,
    plannedSalesDate: row.uriageyoteibi__c,
    lostReason: row.shicchu_riyu__c,
  };
}

export type FocusClientsLoadResult =
  | { ok: true; masters: FocusClientMaster[]; deals: FocusDeal[]; scopeTargets: ScopeTargets }
  | { ok: false; failed: "master" | "salesforce" };

function logFailure(message: string, error: unknown) {
  const kind = error instanceof Error ? error.name : typeof error;
  console.error(`[focusClientRepository] ${message}(${kind})`);
}

/**
 * 注力クライアント管理タブのデータを取得する。取引先一覧(Salesforce)とダッシュボード側の項目(Firestore)を
 * 並行して取り、その後に一覧の社の案件を取る(全社・CR目標の取得も並行)。どちらで失敗したかを返す。
 * 集計(computeFocusClients)は画面側で行う(メモ等を保存した直後に画面へ即時反映するため)。
 * サーバーログにはエラー種別のみを出し、金額や会社名は出さない。
 */
export async function getFocusClients(
  term: number,
  currentTerm: number,
  deps: { dashboardFields?: () => Promise<Map<string, FocusClientDashboardFields>>; client?: SalesforceQueryClient } = {}
): Promise<FocusClientsLoadResult> {
  const queryClient = deps.client ?? new SalesforceClient(getSalesforceJwtConfig());
  const [accountsResult, fieldsResult] = await Promise.allSettled([
    queryClient.query<RawFocusAccountRow>(buildFocusAccountsQuery()),
    (deps.dashboardFields ?? getFocusClientDashboardFields)(),
  ]);
  if (accountsResult.status === "rejected") {
    logFailure("注力クライアントの取引先一覧の取得に失敗しました", accountsResult.reason);
    return { ok: false, failed: "salesforce" };
  }
  if (fieldsResult.status === "rejected") {
    logFailure("注力クライアントのダッシュボード側項目の取得に失敗しました", fieldsResult.reason);
    return { ok: false, failed: "master" };
  }
  const masters = mergeFocusClients(accountsResult.value, fieldsResult.value, currentTerm);
  if (masters.length === 0) return { ok: true, masters, deals: [], scopeTargets: toScopeTargets(undefined) };

  const [dealsResult, scopeTargetsResult] = await Promise.allSettled([
    queryClient.query<RawDealRow>(
      buildFocusClientDealsQuery(
        masters.map((m) => m.accountId),
        fiscalTermDateRange(term)
      )
    ),
    queryClient.query<SalesTargetRow>(buildSalesTargetQuery(term)),
  ]);
  if (dealsResult.status === "rejected") {
    logFailure(`注力クライアントの案件取得に失敗しました(term=${term})`, dealsResult.reason);
    return { ok: false, failed: "salesforce" };
  }
  const deals = dealsResult.value.map(toDeal).filter((d): d is FocusDeal => d !== null);
  // 全社・CR目標はサマリーの参考表示のため、取れなくても画面は出す(「―」表示)
  let scopeTargets = toScopeTargets(undefined);
  if (scopeTargetsResult.status === "fulfilled") {
    scopeTargets = toScopeTargets(scopeTargetsResult.value[0]);
  } else {
    logFailure(`全社目標の取得に失敗しました(term=${term})`, scopeTargetsResult.reason);
  }

  return { ok: true, masters, deals, scopeTargets };
}
