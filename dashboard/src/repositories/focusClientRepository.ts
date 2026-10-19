import { isConcreteCrId } from "@/domain/types";
import { fiscalTermDateRange } from "@/config/fiscalPeriods";
import { getSalesforceJwtConfig } from "@/config/salesforce";
import { SalesforceClient } from "@/services/salesforce/salesforceClient";
import type { SalesforceQueryClient } from "@/services/salesforce/salesforceClient";
import { buildFocusClientDealsQuery, buildOwnerDepartmentsQuery } from "@/services/salesforce/focusClientQueries";
import type { FocusClientMaster, FocusDeal, OwnerCrMap } from "@/features/focus-clients/focusClients";
import { getFocusClientMasters } from "./focusClientMasterRepository";

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

interface RawOwnerRow {
  Name: string | null;
  Department: string | null;
}

/** 同名のユーザーが別々のCRにいる場合はどちらとも決められないため振り分けない */
export function toOwnerCrMap(rows: RawOwnerRow[]): OwnerCrMap {
  const result: OwnerCrMap = {};
  const ambiguous = new Set<string>();
  for (const row of rows) {
    if (!row.Name || !isConcreteCrId(row.Department)) continue;
    if (result[row.Name] && result[row.Name] !== row.Department) ambiguous.add(row.Name);
    result[row.Name] = row.Department;
  }
  for (const name of ambiguous) delete result[name];
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
  | { ok: true; masters: FocusClientMaster[]; deals: FocusDeal[]; ownerCrs: OwnerCrMap; ownerCrsFailed: boolean }
  | { ok: false; failed: "master" | "salesforce" };

/**
 * 注力クライアント管理タブのデータを取得する。マスタ(Firestore)と案件(Salesforce)のどちらで
 * 失敗したかを返す。集計(computeFocusClients)は画面側で行う(目標を編集した直後に達成率・
 * サマリーへ即時反映するため)。サーバーログにはエラー種別のみを出し、金額や会社名は出さない。
 */
export async function getFocusClients(
  term: number,
  isCurrentTerm: boolean,
  deps: { masters?: () => Promise<FocusClientMaster[]>; client?: SalesforceQueryClient } = {}
): Promise<FocusClientsLoadResult> {
  let masters: FocusClientMaster[];
  try {
    masters = await (deps.masters ?? getFocusClientMasters)();
  } catch (error) {
    const kind = error instanceof Error ? error.name : typeof error;
    console.error(`[focusClientRepository] 注力クライアントマスタの取得に失敗しました(${kind})`);
    return { ok: false, failed: "master" };
  }

  const termRange = fiscalTermDateRange(term);
  let deals: FocusDeal[] = [];
  let ownerCrs: OwnerCrMap = {};
  let ownerCrsFailed = false;
  if (masters.length > 0) {
    const queryClient = deps.client ?? new SalesforceClient(getSalesforceJwtConfig());
    try {
      const rows = await queryClient.query<RawDealRow>(
        buildFocusClientDealsQuery(
          masters.map((m) => m.accountId),
          termRange,
          isCurrentTerm
        )
      );
      deals = rows.map(toDeal).filter((d): d is FocusDeal => d !== null);
    } catch (error) {
      const kind = error instanceof Error ? error.name : typeof error;
      console.error(`[focusClientRepository] 注力クライアントの案件取得に失敗しました(term=${term}, ${kind})`);
      return { ok: false, failed: "salesforce" };
    }
    // 所属CRが取れなくても全社タブは表示できるため、失敗はタブ側の注記にとどめる
    try {
      ownerCrs = toOwnerCrMap(await queryClient.query<RawOwnerRow>(buildOwnerDepartmentsQuery()));
    } catch (error) {
      const kind = error instanceof Error ? error.name : typeof error;
      console.error(`[focusClientRepository] 社内担当の所属CRの取得に失敗しました(${kind})`);
      ownerCrsFailed = true;
    }
  }

  return { ok: true, masters, deals, ownerCrs, ownerCrsFailed };
}
