import { isConcreteCrId } from "@/domain/types";
import { fiscalTermDateRange } from "@/config/fiscalPeriods";
import { getSalesforceJwtConfig } from "@/config/salesforce";
import { SalesforceClient } from "@/services/salesforce/salesforceClient";
import type { SalesforceQueryClient } from "@/services/salesforce/salesforceClient";
import { buildFocusClientDealsQuery } from "@/services/salesforce/focusClientQueries";
import type { FocusClientMaster, FocusDeal } from "@/features/focus-clients/focusClients";
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
  | { ok: true; masters: FocusClientMaster[]; deals: FocusDeal[] }
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
  if (masters.length > 0) {
    try {
      const queryClient = deps.client ?? new SalesforceClient(getSalesforceJwtConfig());
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
  }

  return { ok: true, masters, deals };
}
