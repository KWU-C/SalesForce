import { fiscalTermDateRange, getSelectableTerms, getCurrentFiscalPeriod } from "@/config/fiscalPeriods";
import { getSalesforceJwtConfig } from "@/config/salesforce";
import { getConcreteCrIdsForTerm } from "@/domain/types";
import type { CrProgress } from "@/domain/types";
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

interface SalesTargetRow {
  TargetSales__c: number;
  TargetGrossProfit__c: number;
  /** CR別目標粗利の内訳（任意項目、ユーザー確定2026-09-01）。未設定のCRはnull */
  CR1TargetGrossProfit__c: number | null;
  CR2TargetGrossProfit__c: number | null;
  CR3TargetGrossProfit__c: number | null;
  CR4TargetGrossProfit__c: number | null;
}

const CR_GROSS_PROFIT_TARGET_FIELD: Record<string, keyof SalesTargetRow> = {
  CR1: "CR1TargetGrossProfit__c",
  CR2: "CR2TargetGrossProfit__c",
  CR3: "CR3TargetGrossProfit__c",
  CR4: "CR4TargetGrossProfit__c",
};

/** CR別目標粗利の内訳と会社全体目標との差(円)。この範囲を超えたらconsole.warnのみ(検算警告、既存パターンに準拠) */
const GROSS_PROFIT_TARGET_TOLERANCE_YEN = 1;

/**
 * CRごとの年間目標粗利を決める。SalesTarget__cにCR別の内訳(CR1〜4TargetGrossProfit__c)が
 * 設定されていればそれを使い、未設定のCRは会社全体目標をCR数で均等按分した値にフォールバックする
 * （CR別は等分でよい、ユーザー確定2026-08-07。50期はCR別の内訳が別途確定した、ユーザー確定2026-09-01）。
 * 売上目標はCR別の内訳が提供されていないため常に均等按分。
 */
function resolveCrAnnualTargets(
  companyTarget: SalesTargetRow,
  crIds: readonly string[]
): Record<string, AnnualSalesTarget> {
  const equalSplitSales = companyTarget.TargetSales__c / crIds.length;
  const equalSplitGrossProfit = companyTarget.TargetGrossProfit__c / crIds.length;

  const explicitGrossProfits = crIds.map((crId) => companyTarget[CR_GROSS_PROFIT_TARGET_FIELD[crId]]);
  if (explicitGrossProfits.every((v) => v != null)) {
    const sum = explicitGrossProfits.reduce((total, v) => total + (v ?? 0), 0);
    const diff = Math.abs(sum - companyTarget.TargetGrossProfit__c);
    if (diff > GROSS_PROFIT_TARGET_TOLERANCE_YEN) {
      console.warn(
        `[SalesforceSalesProgressDataSource] CR別目標粗利の合計(${sum})が全社目標粗利(${companyTarget.TargetGrossProfit__c})と一致しません(差${diff}円)`
      );
    }
  }

  const result: Record<string, AnnualSalesTarget> = {};
  for (const crId of crIds) {
    const explicit = companyTarget[CR_GROSS_PROFIT_TARGET_FIELD[crId]];
    result[crId] = {
      targetSales: equalSplitSales,
      targetGrossProfit: explicit ?? equalSplitGrossProfit,
    };
  }
  return result;
}

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
   * 期セレクター用。今期・前期・前々期の固定ウィンドウ（ユーザー確定、2026-09-01）。
   * SalesTarget__cのレコード有無には依存しない（無い期を選んでも下でフォールバックする）。
   */
  async getAvailableTerms(): Promise<number[]> {
    return getSelectableTerms();
  }

  async getCrProgress(term?: number): Promise<CrProgress[]> {
    const selectedTerm = term ?? getCurrentFiscalPeriod().term;
    // 対象CR一覧は事業期によって変わる(48・49期はCR1〜3、50期以降はCR1〜4、
    // ユーザー確定2026-09-01)。前期比較データも「今期選択中のCR一覧」を基準に取得する
    const crIds = getConcreteCrIdsForTerm(selectedTerm);

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
        client.query<ProgressAggregateRow>(buildOrderProgressQuery(dateRange, crIds)),
        client.query<ProgressAggregateRow>(buildCompletedProgressQuery(dateRange, crIds)),
        client.query<SalesTargetRow>(buildSalesTargetQuery(selectedTerm)),
        client.query<ProgressAggregateRow>(buildOrderProgressQuery(previousDateRange, crIds)),
        client.query<ProgressAggregateRow>(buildCompletedProgressQuery(previousDateRange, crIds)),
        client.query<RawClientDetailRow>(buildOrderClientRankingQuery(dateRange, crIds)),
        client.query<RawClientDetailRow>(buildCompletedClientRankingQuery(dateRange, crIds)),
        client.query<LeaderAggregateRow>(buildOrderLeaderRankingQuery(dateRange, crIds)),
        client.query<LeaderAggregateRow>(buildCompletedLeaderRankingQuery(dateRange, crIds)),
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
      const companyTarget: SalesTargetRow = targetRows[0] ?? {
        TargetSales__c: 0,
        TargetGrossProfit__c: 0,
        CR1TargetGrossProfit__c: null,
        CR2TargetGrossProfit__c: null,
        CR3TargetGrossProfit__c: null,
        CR4TargetGrossProfit__c: null,
      };
      const targetByCr = resolveCrAnnualTargets(companyTarget, crIds);
      // 前期比較チャートは粗利額のみ使い、目標・達成率は表示しないためダミー値でよい
      const noTarget: AnnualSalesTarget = { targetSales: 0, targetGrossProfit: 0 };

      const perCr: CrProgress[] = crIds.map((crId) => ({
        crId,
        order: mapAggregateRowsToMonthlyProgress(orderRows, crId, "order", targetByCr[crId]),
        completed: mapAggregateRowsToMonthlyProgress(
          completedRows,
          crId,
          "completed",
          targetByCr[crId]
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
