import { fiscalTermDateRange, getCurrentFiscalPeriod } from "@/config/fiscalPeriods";
import { getSalesforceJwtConfig } from "@/config/salesforce";
import type { CrId, CrProgress } from "@/domain/types";
import {
  SalesforceAuthError,
  SalesforceClient,
  SalesforceQueryError,
} from "@/services/salesforce/salesforceClient";
import type { SalesforceQueryClient } from "@/services/salesforce/salesforceClient";
import {
  buildCompletedProgressQuery,
  buildOrderProgressQuery,
  buildSalesTargetQuery,
} from "@/services/salesforce/salesforceQueries";
import type { AnnualSalesTarget, ProgressAggregateRow } from "./salesforceRecordMapper";
import { mapAggregateRowsToMonthlyProgress } from "./salesforceRecordMapper";
import { classifySalesforceError, SalesDataSourceError } from "./salesDataSourceError";
import type { SalesProgressDataSource } from "./salesProgressDataSource";
import { sumMonthlyProgressAcrossCr } from "./sumMonthlyProgressAcrossCr";

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
 * currentMonthは使わない（GoogleSheetsSalesProgressDataSourceと同様、対象事業期は
 * 取得時点の現在時刻から算出する。未到来月は集計行が存在しないため自然にnullになる）。
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

  async getCrProgress(): Promise<CrProgress[]> {
    const { term } = getCurrentFiscalPeriod();

    try {
      const client = this.getClient();
      const dateRange = fiscalTermDateRange(term);

      const previousDateRange = fiscalTermDateRange(term - 1);

      const [orderRows, completedRows, targetRows, previousOrderRows, previousCompletedRows] =
        await Promise.all([
          client.query<ProgressAggregateRow>(buildOrderProgressQuery(dateRange)),
          client.query<ProgressAggregateRow>(buildCompletedProgressQuery(dateRange)),
          client.query<{ TargetSales__c: number; TargetGrossProfit__c: number }>(
            buildSalesTargetQuery(term)
          ),
          client.query<ProgressAggregateRow>(buildOrderProgressQuery(previousDateRange)),
          client.query<ProgressAggregateRow>(buildCompletedProgressQuery(previousDateRange)),
        ]);

      if (targetRows.length === 0) {
        throw new Error(`SalesTarget__cに${term}期のレコードがありません`);
      }
      const companyTarget = targetRows[0];
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
      };

      return [all, ...perCr];
    } catch (error) {
      const category = classifySalesforceError(error);
      console.error(
        `[SalesforceSalesProgressDataSource] 取得に失敗しました term=${term} category=${category}`
      );
      throw new SalesDataSourceError(category, `term=${term}`);
    }
  }
}

export { SalesforceAuthError, SalesforceQueryError };
