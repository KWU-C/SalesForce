// クライアントコンポーネント(OperatingProfitTrendChart)から読み込むため、freee/Firestoreに
// 依存するモジュールはimportしない(型も含めてこのファイルだけで完結させる)。

/** 事業収支の推移グラフの元データ1か月分(月次P/L)。未取得の月は各値がnull */
export interface MonthlyPlPoint {
  /** 暦月(1〜12) */
  month: number;
  revenue: number | null;
  operatingProfit: number | null;
  operatingCost: number | null;
}

/**
 * 事業収支の推移グラフ1か月分の表示用データ(ユーザー確定、2026-10-08)。
 * 棒=単月の営業イン(売上高)/営業アウト(営業コスト)、折れ線=累積営業利益(結果)。
 */
export interface BusinessBalanceRow {
  /** 暦月(1〜12) */
  month: number;
  /** 単月売上高。その月のP/L実績 */
  monthlyRevenue: number | null;
  /**
   * 単月営業コスト(売上原価+販管費に相当) = 単月売上高 − 単月営業利益。コスト額として
   * 正の値で持ち、0円より下へ描くための符号反転はグラフ側(描画データ生成時)だけで行う
   */
  monthlyOperatingCost: number | null;
  /** 累積営業利益 = 期首月からその月までの単月営業利益の合計 */
  cumulativeOperatingProfit: number | null;
}

/**
 * 月次P/Lの並び(期首月から順)を、グラフ表示用の行にする。棒(単月)と折れ線(累積)を
 * 同じ月次データから作るため、両者は必ず整合する。
 *
 * 未取得の月(null)は推測しない。累積営業利益は、単月営業利益が欠けた月以降は合計を
 * 確定できないためnullにする(欠損を0とみなして積み上げない)。
 */
export function toBusinessBalanceRows(points: MonthlyPlPoint[]): BusinessBalanceRow[] {
  let cumulative: number | null = 0;
  return points.map((point) => {
    cumulative = cumulative === null || point.operatingProfit === null ? null : cumulative + point.operatingProfit;
    return {
      month: point.month,
      monthlyRevenue: point.revenue,
      monthlyOperatingCost: point.operatingCost,
      cumulativeOperatingProfit: cumulative,
    };
  });
}
