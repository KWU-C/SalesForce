import { getConcreteCrIdsForTerm, isConcreteCrId } from "@/domain/types";
import type { ConcreteCrId } from "@/domain/types";
import { getCurrentFiscalPeriod } from "@/config/fiscalPeriods";
import { getSalesforceJwtConfig } from "@/config/salesforce";
import { SalesforceClient } from "@/services/salesforce/salesforceClient";
import type { SalesforceQueryClient } from "@/services/salesforce/salesforceClient";
import { buildResourceLoadDealsQuery } from "@/services/salesforce/salesforceQueries";
import { computeResourceLoad } from "@/features/resource-load/resourceLoad";
import type { ResourceLoadDeal, ResourceLoadResult } from "@/features/resource-load/resourceLoad";
import { CR_HEADCOUNT } from "@/config/crHeadcount";

/** 明細取得(非集計)クエリのため、生のAPI名のまま返ってくる(salesforceQueries.tsのコメント参照) */
interface RawResourceLoadDealRow {
  bumonna__c: string;
  arari__c: number | null;
  juchuubi__c: string;
  seikyuubi__c: string;
}

function toResourceLoadDeal(row: RawResourceLoadDealRow): ResourceLoadDeal | null {
  if (!isConcreteCrId(row.bumonna__c)) return null; // 想定外のCR値は無視(推測で扱わない)
  return {
    crId: row.bumonna__c,
    grossProfit: row.arari__c,
    orderDate: row.juchuubi__c,
    completionDate: row.seikyuubi__c,
  };
}

/**
 * 推定負荷率(/resource)を、freeeや既存sales-progressのDataSource抽象化とは独立に、
 * Salesforceから直接取得・算出する。既存の受注/完了/達成率/累計の集計ロジック
 * (SalesProgressDataSource経由)には一切触れない(ユーザー確定、2026-09-18)。
 * モック/Google Sheetsのsales-progressデータソースはこの粒度の明細を持たないため、
 * 現時点ではSalesforce専用機能とする(pipelineDealsと同じ位置づけ)。
 *
 * 取得に失敗した場合はnullを返す(呼び出し側でエラー表示にフォールバックする想定、
 * 他のSalesforce依存箇所と同じ方針)。
 */
export async function getResourceLoad(
  client?: SalesforceQueryClient
): Promise<ResourceLoadResult | null> {
  const { term, currentMonth } = getCurrentFiscalPeriod();
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const crIds = getConcreteCrIdsForTerm(term);
  const currentMonthStart = `${currentYear}-${String(currentMonth).padStart(2, "0")}-01`;

  try {
    const queryClient = client ?? new SalesforceClient(getSalesforceJwtConfig());
    const rows = await queryClient.query<RawResourceLoadDealRow>(
      buildResourceLoadDealsQuery(crIds, currentMonthStart)
    );
    const deals = rows.map(toResourceLoadDeal).filter((d): d is ResourceLoadDeal => d !== null);
    const headcountByCr: Record<ConcreteCrId, number> = CR_HEADCOUNT;
    return computeResourceLoad(deals, crIds, currentYear, currentMonth, headcountByCr);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[resourceLoadRepository] 推定負荷率の取得に失敗しました: ${detail}`);
    return null;
  }
}
