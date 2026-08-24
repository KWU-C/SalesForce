import { getCrReportSheetRef } from "@/config/googleSheets";
import type { CrId, CrProgress } from "@/domain/types";
import type { SheetsValuesReader } from "@/services/google-sheets/sheetsClient";
import { createDefaultReportRegistry } from "./reportDefinitions";
import type { ReportRegistry } from "./reportRegistry";
import { classifySheetsError, SalesDataSourceError } from "./salesDataSourceError";
import type { SalesProgressDataSource } from "./salesProgressDataSource";
import { sumMonthlyProgressAcrossCr } from "./sumMonthlyProgressAcrossCr";

type ConcreteCrId = Exclude<CrId, "ALL">;

const CR_IDS: ConcreteCrId[] = ["CR1", "CR2", "CR3"];

/**
 * Google Sheetsを取得元とする実装。
 *
 * 「Google Sheetsを読む」処理と「どの帳票かを判定してParser/DomainMapperを
 * 選ぶ」処理を分離している。このクラス自身は特定の帳票形式（受注/完了ブロック等）
 * を知らず、取得したグリッドを ReportRegistry に渡すだけ（reportRegistry.ts,
 * reportDefinitions.ts参照）。Parserは「Google Sheetsだから」ではなく
 * 「この帳票の形だから」選ばれる構造になっている。
 *
 * 全社(ALL)は初期フェーズの仕様通りCR1〜CR3の合算（docs/repository-architecture.md
 * 参照。将来、全社推移シートを直接読む方式に切り替える場合はRegistryが
 * 「全社推移」帳票を判定し、companyProgressReportParser.tsへ委ねる）。
 *
 * シート名・スプレッドシートIDは環境変数から解決する（docs/sheet-mapping.md参照、
 * 実際の値は未確認のためこのクラス自体はまだ本番投入しない）。
 *
 * エラー時は必ず SalesDataSourceError を投げる（固定カテゴリのみ）。
 * サーバーログにはシート名とエラー種別のみを出し、金額・認証情報・
 * アクセストークンなど元の例外の詳細は一切出力しない。呼び出し側
 * （app/page.tsx）はこの例外を捕捉し、画面には汎用メッセージのみを表示する。
 * モックへの自動フォールバックは行わない（誤った数値を表示する危険があるため）。
 */
export class GoogleSheetsSalesProgressDataSource implements SalesProgressDataSource {
  private readonly registry: ReportRegistry = createDefaultReportRegistry();

  constructor(private readonly valuesReader: SheetsValuesReader) {}

  // currentMonthは使わない: シート側に存在する月のラベルがそのまま実績（未到来月の
  // 列が無ければ単にその月は返さない）。モックのように「何月まで実績があることに
  // するか」を人工的に決める必要がないため。
  async getCrProgress(): Promise<CrProgress[]> {
    const perCr: CrProgress[] = await Promise.all(
      CR_IDS.map((crId) => this.fetchAndParse(crId))
    );

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
      // 前期比較チャート・クライアント/リーダーランキング用データは未対応（本番投入しない検証用ソースのため）
      previousOrder: [],
      previousCompleted: [],
      topOrderClients: [],
      topCompletedClients: [],
      topOrderLeaders: [],
      topCompletedLeaders: [],
    };

    return [all, ...perCr];
  }

  private async fetchAndParse(crId: ConcreteCrId): Promise<CrProgress> {
    // シート名解決前に失敗した場合(環境変数未設定)のログ用フォールバック
    let sheetLabel: string = crId;

    try {
      const ref = getCrReportSheetRef(crId);
      sheetLabel = ref.sheetName;

      const grid = await this.valuesReader.getValues(ref.spreadsheetId, ref.sheetName);
      const { order, completed, warnings } = this.registry.parse(grid, { crId });

      for (const warning of warnings) {
        console.warn(`[GoogleSheetsSalesProgressDataSource] sheet=${sheetLabel}: ${warning}`);
      }

      return {
        crId,
        order: order ?? [],
        completed: completed ?? [],
        previousOrder: [],
        previousCompleted: [],
        topOrderClients: [],
        topCompletedClients: [],
        topOrderLeaders: [],
        topCompletedLeaders: [],
      };
    } catch (error) {
      const category = classifySheetsError(error);
      console.error(
        `[GoogleSheetsSalesProgressDataSource] シート取得/解析に失敗しました sheet=${sheetLabel} category=${category}`
      );
      throw new SalesDataSourceError(category, sheetLabel);
    }
  }
}
