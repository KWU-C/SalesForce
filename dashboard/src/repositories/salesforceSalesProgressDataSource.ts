import { fiscalTermDateRange, getAdjacentTerms, getCurrentFiscalPeriod } from "@/config/fiscalPeriods";
import { getSalesforceJwtConfig } from "@/config/salesforce";
import type { CrId, CrProgress } from "@/domain/types";
import {
  SalesforceAuthError,
  SalesforceClient,
  SalesforceQueryError,
} from "@/services/salesforce/salesforceClient";
import type { SalesforceQueryClient } from "@/services/salesforce/salesforceClient";
import {
  buildCompletedClientRankingQuery,
  buildCompletedLeaderRankingQuery,
  buildCompletedProgressQuery,
  buildOrderClientRankingQuery,
  buildOrderLeaderRankingQuery,
  buildOrderProgressQuery,
  buildSalesTargetQuery,
} from "@/services/salesforce/salesforceQueries";
import type { AnnualSalesTarget, ProgressAggregateRow } from "./salesforceRecordMapper";
import { mapAggregateRowsToMonthlyProgress } from "./salesforceRecordMapper";
import { classifySalesforceError, SalesDataSourceError } from "./salesDataSourceError";
import type { SalesProgressDataSource } from "./salesProgressDataSource";
import { sumMonthlyProgressAcrossCr } from "./sumMonthlyProgressAcrossCr";
import { rankClients, type ClientDetailRow } from "./clientRanking";
import { rankLeaders, type LeaderAggregateRow } from "./leaderRanking";

/**
 * クライアントランキングSOQLの生レスポンス1行。
 * 非集計クエリなので列エイリアスが使えず(2026-08-24、本番で実際に踏んだ
 * "only aggregate expressions use field aliasing"参照)、キーはフィールド
 * API名そのまま返ってくる。
 */
interface RawClientDetailRow {
  bumonna__c: string;
  clientName__c: string | null;
  clientGroupName__c: string | null;
  arari__c: number | null;
}

function toClientDetailRow(row: RawClientDetailRow): ClientDetailRow {
  return {
    crId: row.bumonna__c,
    clientName: row.clientName__c,
    clientGroupName: row.clientGroupName__c,
    grossProfit: row.arari__c,
  };
}

type ConcreteCrId = Exclude<CrId, "ALL">;

const CR_IDS: ConcreteCrId[] = ["CR1", "CR2", "CR3"];

/**
 * Salesforceを取得元とする実装。
 *
 * 実績: Process__c（受注=受注日+受注確度A+失注除外、完了=請求日+受注確度A+失注除外。
 * 完了の定義はユーザー確定・検算済み、docs/salesforce-reconciliation-2025-09-11.md。
 * 受注の定義は2026-08-17にユーザーが受注確度A限定に確定）
 * 目標: SalesTarget__c（会社全体の年間目標。CR3等分・月12等分はこのクラスで計算、
 * ユーザー確定2026-08-07）
 *
 * getCrProgress(term)にtermを渡さない場合は現在時刻から算出した事業期を使う
 * （GoogleSheetsSalesProgressDataSourceと同様）。未到来月は集計行が存在しないため
 * 自然にnullになる。
 *
 * エラー時は必ずSalesDataSourceErrorを投げる。サーバーログには事業期とエラー種別のみを
 * 出し、認証情報・SOQL文・金額など元の例外の詳細は一切出力しない。モックへの自動
 * フォールバックは行わない（誤った数値を表示する危険があるため、他DataSource実装と同方針）。
 */
export class SalesforceSalesProgressDataSource implements SalesProgressDataSource {
  private readonly injectedClient?: SalesforceQueryClient;

  constructor(client?: SalesforceQueryClient) {
    this.injectedClient = client;
  }

  // getSalesforceJwtConfig()（環境変数の解決）は呼び出し時まで遅延させる。
  // コンストラクタで解決すると、getSalesProgressDataSource()の呼び出し元
  // （app/page.tsx）のtry/catch外で例外が飛び、画面が丸ごとクラッシュしてしまう。
  private getClient(): SalesforceQueryClient {
    return this.injectedClient ?? new SalesforceClient(getSalesforceJwtConfig());
  }

  /**
   * 期セレクター用。前期・今期・来期の固定ウィンドウ（ユーザー確定、2026-08-25）。
   * SalesTarget__cのレコード有無には依存しない（無い期を選んでも下でフォールバックする）。
   */
  async getAvailableTerms(): Promise<number[]> {
    return getAdjacentTerms();
  }

  async getCrProgress(term?: number): Promise<CrProgress[]> {
    const selectedTerm = term ?? getCurrentFiscalPeriod().term;

    try {
      const client = this.getClient();
      const dateRange = fiscalTermDateRange(selectedTerm);

      const previousDateRange = fiscalTermDateRange(selectedTerm - 1);

      const [
        orderRows,
        completedRows,
        targetRows,
        previousOrderRows,
        previousCompletedRows,
        rawOrderClientRows,
        rawCompletedClientRows,
        orderLeaderRows,
        completedLeaderRows,
      ] = await Promise.all([
        client.query<ProgressAggregateRow>(buildOrderProgressQuery(dateRange)),
        client.query<ProgressAggregateRow>(buildCompletedProgressQuery(dateRange)),
        client.query<{ TargetSales__c: number; TargetGrossProfit__c: number }>(
          buildSalesTargetQuery(selectedTerm)
        ),
        client.query<ProgressAggregateRow>(buildOrderProgressQuery(previousDateRange)),
        client.query<ProgressAggregateRow>(buildCompletedProgressQuery(previousDateRange)),
        client.query<RawClientDetailRow>(buildOrderClientRankingQuery(dateRange)),
        client.query<RawClientDetailRow>(buildCompletedClientRankingQuery(dateRange)),
        client.query<LeaderAggregateRow>(buildOrderLeaderRankingQuery(dateRange)),
        client.query<LeaderAggregateRow>(buildCompletedLeaderRankingQuery(dateRange)),
      ]);
      const orderClientRows = rawOrderClientRows.map(toClientDetailRow);
      const completedClientRows = rawCompletedClientRows.map(toClientDetailRow);
      // 「◯◯期新規」のラベルは事業期ごとに更新される想定のため、期数はハードコードしない
      const newClientMarker = `${selectedTerm}期新規`;

      // 前後1期(48/50期のような隣接期)はSalesTarget__cにまだレコードが無いことがある
      // （目標未設定）。全体をエラーにはせず、目標0(=達成率も0%)として扱う。
      if (targetRows.length === 0) {
        console.warn(
          `[SalesforceSalesProgressDataSource] SalesTarget__cに${selectedTerm}期のレコードがありません。目標未設定として扱います`
        );
      }
      const companyTarget = targetRows[0] ?? { TargetSales__c: 0, TargetGrossProfit__c: 0 };
      const perCrTarget: AnnualSalesTarget = {
        targetSales: companyTarget.TargetSales__c / CR_IDS.length,
        targetGrossProfit: companyTarget.TargetGrossProfit__c / CR_IDS.length,
      };
      // 前期比較チャートは粗利額のみ使い、目標・達成率は表示しないためダミー値でよい
      const noTarget: AnnualSalesTarget = { targetSales: 0, targetGrossProfit: 0 };

      const perCr: CrProgress[] = CR_IDS.map((crId) => ({
        crId,
        order: mapAggregateRowsToMonthlyProgress(orderRows, crId, "order", perCrTarget),
        completed: mapAggregateRowsToMonthlyProgress(
          completedRows,
          crId,
          "completed",
          perCrTarget
        ),
        previousOrder: mapAggregateRowsToMonthlyProgress(
          previousOrderRows,
          crId,
          "order",
          noTarget
        ),
        previousCompleted: mapAggregateRowsToMonthlyProgress(
          previousCompletedRows,
          crId,
          "completed",
          noTarget
        ),
        topOrderClients: rankClients(orderClientRows, crId, newClientMarker),
        topCompletedClients: rankClients(completedClientRows, crId, newClientMarker),
        topOrderLeaders: rankLeaders(orderLeaderRows, crId),
        topCompletedLeaders: rankLeaders(completedLeaderRows, crId),
      }));

      const all: CrProgress = {
        crId: "ALL",
        order: sumMonthlyProgressAcrossCr(
          perCr.map((p) => p.order),
          "order"
        ),
        completed: sumMonthlyProgressAcrossCr(
          perCr.map((p) => p.completed),
          "completed"
        ),
        previousOrder: sumMonthlyProgressAcrossCr(
          perCr.map((p) => p.previousOrder),
          "order"
        ),
        previousCompleted: sumMonthlyProgressAcrossCr(
          perCr.map((p) => p.previousCompleted),
          "completed"
        ),
        topOrderClients: rankClients(orderClientRows, "ALL", newClientMarker),
        topCompletedClients: rankClients(completedClientRows, "ALL", newClientMarker),
        topOrderLeaders: rankLeaders(orderLeaderRows, "ALL"),
        topCompletedLeaders: rankLeaders(completedLeaderRows, "ALL"),
      };

      return [all, ...perCr];
    } catch (error) {
      const category = classifySalesforceError(error);
      console.error(
        `[SalesforceSalesProgressDataSource] 取得に失敗しました term=${selectedTerm} category=${category}`
      );
      throw new SalesDataSourceError(category, `term=${selectedTerm}`);
    }
  }
}

export { SalesforceAuthError, SalesforceQueryError };
