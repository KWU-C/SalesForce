import { formatDateTime } from "@/utils/format";
import { SectionBanner } from "./SectionBanner";
import { MonthlyPerformanceChart } from "./MonthlyPerformanceChart";
import type { PerformanceChartPoint } from "./MonthlyPerformanceChart";
import { PerformanceTable } from "./PerformanceTable";
import type { PerformanceTableHeads, PerformanceTableRow } from "./PerformanceTable";
import {
  changeRate,
  cumulative,
  monthValue,
  monthsWithoutWipTransfer,
  ratioToRevenue,
  sumValues,
  wipStatusLabel,
} from "./performanceView";
import type { AmountField, PerformanceMonth } from "./performanceView";

/** 金額の行(当期)と、その下の前年同月の行 */
export function amountRows(months: PerformanceMonth[], field: AmountField, label: string, bold = false): PerformanceTableRow[] {
  const current = cumulative(months, field, "current");
  const previous = cumulative(months, field, "previous");
  return [
    {
      kind: "amount",
      label,
      values: months.map((m) => monthValue(m.current, field)),
      cumulative: current,
      previousCumulative: previous,
      changeRate: changeRate(current, previous),
      bold,
    },
    {
      kind: "amount",
      label: "前年同月",
      values: months.map((m) => monthValue(m.previous, field)),
      cumulative: null,
      previousCumulative: null,
      sub: true,
    },
  ];
}

/** 売上高に対する比率の行(当期)と、その下の前年同月の行。累計は累計額どうしの比率 */
export function ratioRows(months: PerformanceMonth[], field: AmountField, label: string): PerformanceTableRow[] {
  const rate = (side: "current" | "previous") =>
    months.map((m) => ratioToRevenue(monthValue(m[side], field), monthValue(m[side], "revenue")));
  return [
    {
      kind: "rate",
      label,
      values: rate("current"),
      cumulative: ratioToRevenue(cumulative(months, field, "current"), cumulative(months, "revenue", "current")),
      previousCumulative: ratioToRevenue(
        cumulative(months, field, "previous"),
        cumulative(months, "revenue", "previous")
      ),
    },
    { kind: "rate", label: "前年同月", values: rate("previous"), cumulative: null, previousCumulative: null, sub: true },
  ];
}

function cumulativeUpTo(months: PerformanceMonth[], index: number, field: AmountField, side: "current" | "previous") {
  return sumValues(months.slice(0, index + 1).map((m) => monthValue(m[side], field)));
}

/** 最も新しい取得日時(当期の月のうち) */
export function latestFetchedAt(dates: (Date | null)[]): Date | null {
  return dates.reduce<Date | null>((latest, d) => (d !== null && (latest === null || d > latest) ? d : latest), null);
}

/**
 * ② 月次業績の推移(ユーザー確定、2026-10-27)。グラフ(単月の金額/累計粗利益率)と月次表(当月実績・累計・
 * 前年同期比較)。仕掛品振替は「反映あり/未検出」の事実だけを示し、月次決算の確定は判定しない。
 */
export function MonthlyPerformanceSection({
  months,
  fetchedAt,
  heads,
}: {
  months: PerformanceMonth[];
  fetchedAt: Date | null;
  heads?: PerformanceTableHeads;
}) {
  const chartPoints: PerformanceChartPoint[] = months.map((m, i) => ({
    month: m.month,
    revenue: monthValue(m.current, "revenue"),
    grossProfit: monthValue(m.current, "grossProfit"),
    operatingProfit: monthValue(m.current, "operatingProfit"),
    cumulativeGrossRate: ratioToRevenue(
      cumulativeUpTo(months, i, "grossProfit", "current"),
      cumulativeUpTo(months, i, "revenue", "current")
    ),
    previousCumulativeGrossRate: ratioToRevenue(
      cumulativeUpTo(months, i, "grossProfit", "previous"),
      cumulativeUpTo(months, i, "revenue", "previous")
    ),
    noWipTransfer: m.current !== null && !m.current.wipTransferDetected,
  }));

  const rows: PerformanceTableRow[] = [
    ...amountRows(months, "revenue", "売上高", true),
    ...amountRows(months, "grossProfit", "売上総利益", true),
    ...ratioRows(months, "grossProfit", "粗利益率"),
    ...amountRows(months, "operatingProfit", "営業利益", true),
    ...ratioRows(months, "operatingProfit", "営業利益率"),
    ...amountRows(months, "ordinaryProfit", "経常利益"),
    {
      kind: "text",
      label: "仕掛品振替",
      values: months.map((m) => wipStatusLabel(m.current)),
      note: "freeeの[製]期末仕掛品の当月の仕訳の有無",
    },
  ];
  const noWipMonths = monthsWithoutWipTransfer(months);

  return (
    <div className="flex flex-col gap-2">
      <SectionBanner>月次業績の推移</SectionBanner>
      <MonthlyPerformanceChart points={chartPoints} />
      <p className="text-sm text-[var(--text-secondary)]">
        {`単位：円（比率は%）。▲はマイナス。${heads?.inProgressMonth ? `${heads.inProgressMonth}月は途中の帳簿値（freeeに登録済みの取引まで）です。` : ""}`}
      </p>
      <PerformanceTable months={months.map((m) => m.month)} rows={rows} heads={heads} />
      <div className="flex flex-col gap-0.5 text-sm text-[var(--text-secondary)]">
        <p>
          {"※ 累計の2列は概要の経営サマリーと同じ対象期間・定義です。前年同期比は増減額を基本とし、前年が赤字・0円のときは増減率を出しません。比率はポイント差。"}
        </p>
        {noWipMonths.length > 0 && (
          <p>
            ※ {noWipMonths.map((m) => `${m}月`).join("・")}
            {"は仕掛品振替が未検出のため、単月の売上総利益・粗利益率が大きく振れることがあります。累計の粗利益率を中心にご確認ください。"}
          </p>
        )}
        {fetchedAt && <p>データ取得日時（freee）: {formatDateTime(fetchedAt)}</p>}
      </div>
      <details className="rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)] text-sm text-[var(--text-secondary)]">
        <summary className="cursor-pointer px-4 py-2">用語と計算の定義</summary>
        <div className="flex flex-col gap-1 px-4 pb-3">
          <p>売上総利益 ＝ 売上高 − 売上原価（仕掛品の期首・期末調整を含む）。営業利益 ＝ 売上総利益 − 販管費。経常利益 ＝ 営業利益 ＋ 営業外損益。</p>
          <p>累計・仕掛品振替反映分（経理確認済み）：期首から、経理確認で指定された月（指定が無い間は、月末後に取得しfreeeで仕掛品振替が確認できた月）までの月次の合計。概要の経営サマリーの上段と同じ。</p>
          <p>帳簿上の進捗：期首から当月までの月次の合計。当月はfreeeに登録済みの当月日付の取引を含む途中の値で、確定実績・予測ではない。概要の経営サマリーの下段と同じ。</p>
          <p>仕掛品振替：freeeの[製]期末仕掛品の当月の仕訳の有無。未検出の月は単月の売上総利益・粗利益率が大きく振れることがある。</p>
        </div>
      </details>
    </div>
  );
}
