import { FISCAL_MONTH_ORDER, fiscalMonthIndex } from "@/config/fiscalPeriods";
import type { CrId, CrProgress, MonthlyProgress, ProgressKind } from "@/domain/types";
import type { SalesProgressDataSource } from "./salesProgressDataSource";
import { sumMonthlyProgressAcrossCr } from "./sumMonthlyProgressAcrossCr";

type ConcreteCrId = Exclude<CrId, "ALL">;

const CR_IDS: ConcreteCrId[] = ["CR1", "CR2", "CR3"];

/**
 * モック用の仮の粗利率（実データではない。売上=粗利÷粗利率で逆算するために使用）。
 * 実データ接続後は不要（Sheetsから売上・粗利それぞれの実績を直接取得する）。
 */
const MOCK_GROSS_MARGIN: Record<ConcreteCrId, number> = {
  CR1: 0.32,
  CR2: 0.35,
  CR3: 0.3,
};

function seededRandom(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

function buildMonthlySeries(
  crId: ConcreteCrId,
  crIndex: number,
  kind: ProgressKind,
  upToFiscalIndex: number,
  seedOffset = 0
): MonthlyProgress[] {
  const baseTarget = 3_000_000 + crIndex * 500_000;
  const margin = MOCK_GROSS_MARGIN[crId];

  return FISCAL_MONTH_ORDER.map((calendarMonth, i) => {
    const fiscalIndex = i + 1;
    const seed = seedOffset + crIndex * 100 + fiscalIndex * 7 + (kind === "order" ? 1 : 2);
    const variance = 0.7 + seededRandom(seed) * 0.6;
    const targetGrossProfit = baseTarget + fiscalIndex * 20_000;
    const isFuture = fiscalIndex > upToFiscalIndex;
    // 未到来月は「未入力」としてnullにする（0円実績とは区別する）
    const grossProfit = isFuture ? null : Math.round(targetGrossProfit * variance);
    const sales = grossProfit === null ? null : Math.round(grossProfit / margin);
    const achievementRate =
      grossProfit === null
        ? null
        : targetGrossProfit === 0
          ? 0
          : Math.round((grossProfit / targetGrossProfit) * 1000) / 10;

    return {
      crId,
      kind,
      month: calendarMonth,
      sales,
      grossProfit,
      targetGrossProfit,
      achievementRate,
    };
  });
}

/**
 * 前期（1事業期前）は決算済みのため全月実績があるものとして生成する
 * （seedOffsetで今期と異なる系列にする。前期／今期比較チャート専用のモック）。
 */
function buildPreviousYearSeries(
  crId: ConcreteCrId,
  crIndex: number,
  kind: ProgressKind
): MonthlyProgress[] {
  return buildMonthlySeries(crId, crIndex, kind, 12, 1000);
}

export class MockSalesProgressDataSource implements SalesProgressDataSource {
  async getCrProgress(currentMonth: number): Promise<CrProgress[]> {
    const upToFiscalIndex = fiscalMonthIndex(currentMonth);

    const orderByCr = CR_IDS.map((crId, i) =>
      buildMonthlySeries(crId, i, "order", upToFiscalIndex)
    );
    const completedByCr = CR_IDS.map((crId, i) =>
      buildMonthlySeries(crId, i, "completed", upToFiscalIndex)
    );
    const previousOrderByCr = CR_IDS.map((crId, i) =>
      buildPreviousYearSeries(crId, i, "order")
    );
    const previousCompletedByCr = CR_IDS.map((crId, i) =>
      buildPreviousYearSeries(crId, i, "completed")
    );

    const perCr: CrProgress[] = CR_IDS.map((crId, i) => ({
      crId,
      order: orderByCr[i],
      completed: completedByCr[i],
      previousOrder: previousOrderByCr[i],
      previousCompleted: previousCompletedByCr[i],
    }));

    const all: CrProgress = {
      crId: "ALL",
      order: sumMonthlyProgressAcrossCr(orderByCr, "order"),
      completed: sumMonthlyProgressAcrossCr(completedByCr, "completed"),
      previousOrder: sumMonthlyProgressAcrossCr(previousOrderByCr, "order"),
      previousCompleted: sumMonthlyProgressAcrossCr(previousCompletedByCr, "completed"),
    };

    return [all, ...perCr];
  }
}
