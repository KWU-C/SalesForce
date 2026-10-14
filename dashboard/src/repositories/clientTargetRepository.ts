import { isConcreteCrId } from "@/domain/types";
import type { ConcreteCrId } from "@/domain/types";
import { fiscalTermDateRange } from "@/config/fiscalPeriods";
import { getSalesforceJwtConfig } from "@/config/salesforce";
import { SalesforceClient } from "@/services/salesforce/salesforceClient";
import type { SalesforceQueryClient } from "@/services/salesforce/salesforceClient";
import { buildSalesTargetQuery } from "@/services/salesforce/salesforceQueries";
import {
  buildClientCompletedRowsQuery,
  buildClientOrderRowsQuery,
  buildClientSalesRepRowsQuery,
  buildClientTargetRowsQuery,
} from "@/services/salesforce/clientTargetQueries";
import { computeClientTargetProgress } from "@/features/client-targets/clientTargets";
import type { ClientAmountRow, ClientSalesRepRow, ClientTargetScope } from "@/features/client-targets/clientTargets";

/** 明細取得(非集計)クエリのため、生のAPI名のまま返ってくる(clientTargetQueries.ts参照) */
interface RawTargetRow {
  bumon__c: string | null;
  clientName__c: string | null;
  kobetsuuriagebi__c: string | null;
  mokuhyoarari__c: number | null;
}

interface RawCompletedRow {
  bumonna__c: string | null;
  clientName__c: string | null;
  seikyuubi__c: string | null;
  arari__c: number | null;
}

interface RawOrderRow {
  bumonna__c: string | null;
  clientName__c: string | null;
  juchuubi__c: string | null;
  arari__c: number | null;
}

interface RawSalesRepRow {
  bumonna__c: string | null;
  clientName__c: string | null;
  eigyoutantousha__r: { Name: string | null } | null;
  arari__c: number | null;
}

function toSalesRepRow(row: RawSalesRepRow): ClientSalesRepRow | null {
  const name = row.eigyoutantousha__r?.Name;
  if (!isConcreteCrId(row.bumonna__c) || !name) return null;
  return { crId: row.bumonna__c, clientName: row.clientName__c, salesRepName: name, grossProfit: row.arari__c };
}

type SalesTargetRow = Partial<Record<`CR${1 | 2 | 3 | 4}TargetGrossProfit__c`, number | null>>;

function toAmountRow(
  crId: string | null,
  clientName: string | null,
  date: string | null,
  grossProfit: number | null
): ClientAmountRow | null {
  // 想定外のCR値・日付の無い行は推測で扱わず除外する(SOQL側で絞っているため通常は発生しない)
  if (!isConcreteCrId(crId) || !date) return null;
  return { crId, clientName, date, grossProfit };
}

const isRow = (row: ClientAmountRow | null): row is ClientAmountRow => row !== null;

/**
 * クライアント別目標タブ(/client-targets)のデータを、営業進捗タブのDataSource抽象化とは
 * 独立にSalesforceから直接取得・集計する(ユーザー確定、2026-10-14。/resourceと同じ位置づけ)。
 *
 * 目標: Profit__c「目標」レコード(既存Salesforceレポート「クライアント別目標進捗」と同じ)
 * 実績: Process__c(営業進捗タブの受注・完了と同じ条件)
 * CR年間目標: SalesTarget__c(営業進捗タブと同じ。目標レコード合計との差の表示用)
 * 担当者: Process__cの営業担当者(粗利最大)
 *
 * 取得に失敗した場合はnullを返す。サーバーログにはエラー種別のみを出し、金額や
 * クライアント名は出さない。
 */
export async function getClientTargetProgress(
  term: number,
  crIds: readonly ConcreteCrId[],
  currentMonth: number,
  client?: SalesforceQueryClient
): Promise<ClientTargetScope[] | null> {
  try {
    const queryClient = client ?? new SalesforceClient(getSalesforceJwtConfig());
    const dateRange = fiscalTermDateRange(term);
    // 担当者は前期期首〜当期末の案件から決める(期首直後で当期の案件が少ない時期も空欄にしないため)
    const salesRepRange = { start: fiscalTermDateRange(term - 1).start, end: dateRange.end };
    const [targetRows, completedRows, orderRows, salesTargetRows, salesRepRows] = await Promise.all([
      queryClient.query<RawTargetRow>(buildClientTargetRowsQuery(dateRange, crIds)),
      queryClient.query<RawCompletedRow>(buildClientCompletedRowsQuery(dateRange, crIds)),
      queryClient.query<RawOrderRow>(buildClientOrderRowsQuery(dateRange, crIds)),
      queryClient.query<SalesTargetRow>(buildSalesTargetQuery(term)),
      queryClient.query<RawSalesRepRow>(buildClientSalesRepRowsQuery(salesRepRange, crIds)),
    ]);

    const salesTarget = salesTargetRows[0];
    const crAnnualTargets: Partial<Record<ConcreteCrId, number | null>> = {};
    for (const crId of crIds) {
      crAnnualTargets[crId] = salesTarget?.[`${crId}TargetGrossProfit__c`] ?? null;
    }

    return computeClientTargetProgress({
      crIds,
      currentMonth,
      targets: targetRows
        .map((r) => toAmountRow(r.bumon__c, r.clientName__c, r.kobetsuuriagebi__c, r.mokuhyoarari__c))
        .filter(isRow),
      completed: completedRows
        .map((r) => toAmountRow(r.bumonna__c, r.clientName__c, r.seikyuubi__c, r.arari__c))
        .filter(isRow),
      orders: orderRows
        .map((r) => toAmountRow(r.bumonna__c, r.clientName__c, r.juchuubi__c, r.arari__c))
        .filter(isRow),
      salesReps: salesRepRows.map(toSalesRepRow).filter((r): r is ClientSalesRepRow => r !== null),
      crAnnualTargets,
    });
  } catch (error) {
    const kind = error instanceof Error ? error.name : typeof error;
    console.error(`[clientTargetRepository] クライアント別目標の取得に失敗しました(term=${term}, ${kind})`);
    return null;
  }
}
