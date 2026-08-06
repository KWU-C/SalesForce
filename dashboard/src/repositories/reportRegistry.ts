import { findCellsInRegion, fullRegion, SheetParseError } from "./parsers/sheetGrid";
import type { DomainMapContext, DomainMapResult } from "./parsers/domainMapping";

/**
 * 1つの帳票の定義。
 * - name: 帳票名（人間向け・診断ログ用）
 * - requiredLabels: この帳票と判定するために必須のラベル文字列群
 * - parser: 帳票形式に依存する生データ抽出（セル座標非依存、業務ルールを持たない）
 * - domainMapper: 帳票形式に依存しない業務ルール（達成率再計算・検算・Domain変換）
 *
 * Parserは「Google Sheetsだから」ではなく「この帳票の形だから」この実装、
 * という対応関係になる（Google Sheets APIの詳細を一切知らない。入力はただの
 * string[][]グリッド）。
 */
export interface ReportDefinition<TRaw> {
  name: string;
  requiredLabels: string[];
  parser: (grid: string[][]) => TRaw;
  domainMapper: (raw: TRaw, context: DomainMapContext) => DomainMapResult;
}

interface RegisteredReport {
  name: string;
  requiredLabels: string[];
  matches: (grid: string[][]) => boolean;
  run: (grid: string[][], context: DomainMapContext) => DomainMapResult;
}

/**
 * 「Google Sheetsを読む」のではなく「取得したグリッドがどの帳票か判定し、
 * 対応するParser→DomainMapperへ処理を委ねる」ためのレジストリ。
 *
 * 判定は必須ラベルの充足度（最も多くのrequiredLabelsを満たす定義）で行う。
 * 同数で並んだ場合は一意に決められないため、明確なエラーにする。
 * これにより、例えば「売上/粗利/目標粗利」しか必須としない緩い定義と、
 * 「受注/完了/売上/粗利/目標粗利」を必須とする厳しい定義が両方マッチしうる
 * グリッドが来ても、より条件の多い（＝より具体的な）定義が優先される。
 */
export class ReportRegistry {
  private reports: RegisteredReport[] = [];

  register<TRaw>(definition: ReportDefinition<TRaw>): void {
    if (definition.requiredLabels.length === 0) {
      throw new Error(
        `帳票定義「${definition.name}」のrequiredLabelsが空です。判定不能なため登録できません`
      );
    }

    this.reports.push({
      name: definition.name,
      requiredLabels: definition.requiredLabels,
      matches: (grid) => this.hasAllLabels(grid, definition.requiredLabels),
      run: (grid, context) => definition.domainMapper(definition.parser(grid), context),
    });
  }

  private hasAllLabels(grid: string[][], labels: string[]): boolean {
    const region = fullRegion(grid);
    return labels.every((label) => findCellsInRegion(grid, label, region).length > 0);
  }

  private selectReport(grid: string[][]): RegisteredReport {
    const matched = this.reports.filter((r) => r.matches(grid));

    if (matched.length === 0) {
      throw new SheetParseError(
        `どの帳票定義にも一致しませんでした。登録済み帳票: ${this.describeAll()}`
      );
    }

    const maxLabelCount = Math.max(...matched.map((r) => r.requiredLabels.length));
    const mostSpecific = matched.filter((r) => r.requiredLabels.length === maxLabelCount);

    if (mostSpecific.length > 1) {
      throw new SheetParseError(
        `複数の帳票定義が同程度の一致度で該当し、一意に判定できませんでした: ` +
          `${mostSpecific.map((r) => r.name).join(", ")}。requiredLabelsを見直してください`
      );
    }

    return mostSpecific[0];
  }

  /** グリッドがどの帳票か判定し、帳票名を返す（診断用） */
  identify(grid: string[][]): string {
    return this.selectReport(grid).name;
  }

  /** グリッドの帳票を判定し、対応するParser→DomainMapperを実行してDomain変換結果を返す */
  parse(grid: string[][], context: DomainMapContext): DomainMapResult {
    return this.selectReport(grid).run(grid, context);
  }

  private describeAll(): string {
    if (this.reports.length === 0) return "(登録なし)";
    return this.reports.map((r) => `${r.name}[${r.requiredLabels.join("/")}]`).join(", ");
  }
}
