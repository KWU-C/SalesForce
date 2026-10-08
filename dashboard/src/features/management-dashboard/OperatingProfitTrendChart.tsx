"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { calendarYearForTermMonth } from "@/config/fiscalPeriods";
import { useCssVar } from "@/utils/useCssVar";
import { formatYen } from "@/utils/format";
import { toBusinessBalanceRows } from "./businessBalanceRows";
import type { MonthlyPlPoint } from "./businessBalanceRows";

interface OperatingProfitTrendChartProps {
  term: number;
  /** 期首月(9月)から当月までの月次P/L。未取得の月は値がnull */
  points: MonthlyPlPoint[];
}

interface ChartRow {
  month: number;
  year: number;
  /** 単月売上高。0円より上の棒 */
  revenue: number | null;
  /** 単月営業コスト(コスト額、正の値)。ツールチップ表示用 */
  cost: number | null;
  /** 単月営業コストの描画値。0円より下の棒にするため、ここ(描画データ)でだけ符号を反転する */
  costBar: number | null;
  /** 累積営業利益。折れ線 */
  operatingProfit: number | null;
  /** 最新月(=現在月)かどうか。ポイントを目立たせるのに使う */
  isCurrent: boolean;
}

const REVENUE_LABEL = "売上高（単月）";
const COST_LABEL = "営業コスト（単月）";
const PROFIT_LABEL = "営業利益（累積）";

function manYenTick(v: number): string {
  if (v === 0) return "0";
  return `${Math.round(v / 10000).toLocaleString("ja-JP")}万`;
}

/**
 * 0を必ず含む、きりの良い等間隔のY軸目盛りを作る。recharts任せだと0が目盛りに
 * 乗らないことがあり、0円ライン(売上/営業コストの境目、累積黒字/赤字の境目)が
 * 読み取りにくくなるため明示的に決める。データ点が1つ(または全月が近い値)しかない
 * 場合も、必ず複数の異なる目盛りが出る(同じ丸め値が並ばない、ユーザー確定、2026-09-22)。
 */
function yTicksIncludingZero(values: number[]): number[] {
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const range = Math.max(max - min, 2_000_000);
  const rough = range / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = ([1, 2, 5, 10].find((m) => m * magnitude >= rough) ?? 10) * magnitude;
  // データが目盛りの端に張り付かないよう、0と反対側の端には必ず1目盛り分の余白を取る
  const lo = min < 0 ? Math.floor(min / step) * step - (min % step === 0 ? step : 0) : 0;
  const hi = max > 0 ? Math.ceil(max / step) * step + (max % step === 0 ? step : 0) : step;
  const ticks: number[] = [];
  for (let t = lo; t <= hi; t += step) ticks.push(t);
  return ticks;
}

function BarSwatch({ color }: { color: string }) {
  return <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: color }} />;
}

function LineSwatch({ color }: { color: string }) {
  return (
    <span className="relative inline-block h-[2px] w-4 shrink-0" style={{ backgroundColor: color }}>
      <span
        className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ backgroundColor: color }}
      />
    </span>
  );
}

function TooltipValue({ value, seriousColor }: { value: number | null; seriousColor: string }) {
  if (value === null) return <span className="ml-auto pl-3 text-[var(--text-muted)]">—</span>;
  return (
    <span
      className={`ml-auto pl-3 font-medium tabular-nums ${value < 0 ? "" : "text-[var(--text-primary)]"}`}
      style={value < 0 ? { color: seriousColor } : undefined}
    >
      {formatYen(value)}
    </span>
  );
}

function TrendTooltip({
  active,
  payload,
  revenueColor,
  costColor,
  profitColor,
  seriousColor,
}: {
  active?: boolean;
  payload?: { payload: ChartRow }[];
  revenueColor: string;
  costColor: string;
  profitColor: string;
  seriousColor: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload;
  if (row.revenue === null && row.cost === null && row.operatingProfit === null) return null;
  return (
    <div className="rounded-md border border-[var(--border-hairline)] bg-[var(--surface-1)] px-3 py-2 text-sm shadow-sm">
      <p className="mb-1 text-xs text-[var(--text-muted)]">
        {row.year}年{row.month}月
      </p>
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <BarSwatch color={revenueColor} />
          <span className="text-[var(--text-secondary)]">{REVENUE_LABEL}</span>
          <TooltipValue value={row.revenue} seriousColor={seriousColor} />
        </div>
        {/* 営業コストは描画上はマイナスだが、ここではコスト額(正の値)として表示する */}
        <div className="flex items-center gap-2">
          <BarSwatch color={costColor} />
          <span className="text-[var(--text-secondary)]">{COST_LABEL}</span>
          <TooltipValue value={row.cost} seriousColor={seriousColor} />
        </div>
        <div className="flex items-center gap-2">
          <LineSwatch color={profitColor} />
          <span className="text-[var(--text-secondary)]">{PROFIT_LABEL}</span>
          <TooltipValue value={row.operatingProfit} seriousColor={seriousColor} />
        </div>
      </div>
    </div>
  );
}

/**
 * 事業収支の推移(9月〜当月)。単月の営業イン/アウトと当期累積の結果を1枚で見せる
 * (ユーザー確定、2026-10-08)。
 * - 棒(単月): 売上高=0円より上、営業コスト(売上高−営業利益)=0円より下。同じ月は同じ位置に上下で並べる
 * - 折れ線(累積): 9月からその月までの累積営業利益。0円より上なら当期累積黒字
 * 3系列とも同じ金額軸(第2Y軸なし)。粗利益・経常利益・目標・前期比較は載せない。
 *
 * 棒も折れ線も、同じ月次P/L(monthlyPlSnapshots、freeeを月指定で取得した実績)から作る。
 * 累積営業利益は単月営業利益の積み上げで、未取得の月(null)は棒を出さず、折れ線もつながない
 * (補間しない)。更新時に月次合計と上部カード(当期累計)が一致することを検算している。
 */
export function OperatingProfitTrendChart({ term, points }: OperatingProfitTrendChartProps) {
  const revenueColor = useCssVar("--series-1", "#2a78d6");
  const costColor = useCssVar("--series-2", "#eb6834");
  // 折れ線は主役(今期ここまでプラスかマイナスか)。色付きの棒に重なっても埋もれないよう、
  // 系列色ではなく最もコントラストの高い文字色(ライト=黒/ダーク=白)で描く
  const profitColor = useCssVar("--text-primary", "#0b0b0b");
  const seriousColor = useCssVar("--status-serious", "#d03b3b");
  const gridline = useCssVar("--gridline", "#e1e0d9");
  const muted = useCssVar("--text-muted", "#898781");
  const secondary = useCssVar("--text-secondary", "#52514e");
  const baseline = useCssVar("--baseline", "#c3c2b7");
  const surface = useCssVar("--surface-1", "#fcfcfb");

  const rows = toBusinessBalanceRows(points);
  const data: ChartRow[] = rows.map((r, i) => ({
    month: r.month,
    year: calendarYearForTermMonth(term, r.month),
    revenue: r.monthlyRevenue,
    cost: r.monthlyOperatingCost,
    costBar: r.monthlyOperatingCost === null ? null : -r.monthlyOperatingCost,
    operatingProfit: r.cumulativeOperatingProfit,
    isCurrent: i === rows.length - 1,
  }));

  const values = data
    .flatMap((d) => [d.revenue, d.costBar, d.operatingProfit])
    .filter((v): v is number => v !== null);
  const hasData = values.length > 0;
  const yTicks = yTicksIncludingZero(values);
  const yDomain: [number, number] = [yTicks[0], yTicks[yTicks.length - 1]];

  function renderDot(props: unknown) {
    const { cx, cy, payload } = props as { cx?: number; cy?: number; payload?: ChartRow };
    if (cx === undefined || cy === undefined || !payload || payload.operatingProfit === null) {
      return <g key={`d-${payload?.month}`} />;
    }
    return (
      <circle
        key={`d-${payload.month}`}
        cx={cx}
        cy={cy}
        r={payload.isCurrent ? 6 : 4}
        fill={profitColor}
        stroke={surface}
        strokeWidth={2}
      />
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <p className="text-xs font-medium text-[var(--text-muted)]">事業収支の推移</p>
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--text-secondary)]">
          <li className="flex items-center gap-1.5">
            <BarSwatch color={revenueColor} />
            {REVENUE_LABEL}
          </li>
          <li className="flex items-center gap-1.5">
            <BarSwatch color={costColor} />
            {COST_LABEL}
          </li>
          <li className="flex items-center gap-1.5">
            <LineSwatch color={profitColor} />
            {PROFIT_LABEL}
          </li>
        </ul>
      </div>
      <div className="rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)] p-4">
        {hasData ? (
          <ResponsiveContainer width="100%" height={280}>
            {/* stackOffset="sign": 同じ月の売上高(正)と営業コスト(負)を、同じ位置で0円から上下に伸ばす */}
            <ComposedChart
              data={data}
              stackOffset="sign"
              barCategoryGap="30%"
              margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
            >
              <CartesianGrid stroke={gridline} vertical={false} />
              <XAxis
                dataKey="month"
                tickFormatter={(m: number) => `${m}月`}
                stroke={muted}
                tick={{ fill: muted, fontSize: 12 }}
                axisLine={{ stroke: baseline }}
                tickLine={false}
                interval="preserveStartEnd"
                minTickGap={2}
              />
              <YAxis
                domain={yDomain}
                ticks={yTicks}
                tickFormatter={manYenTick}
                stroke={muted}
                tick={{ fill: muted, fontSize: 12 }}
                axisLine={{ stroke: baseline }}
                tickLine={false}
                width={64}
              />
              <Tooltip
                cursor={{ fill: gridline, fillOpacity: 0.5 }}
                content={
                  <TrendTooltip
                    revenueColor={revenueColor}
                    costColor={costColor}
                    profitColor={profitColor}
                    seriousColor={seriousColor}
                  />
                }
              />
              <Bar
                dataKey="revenue"
                name={REVENUE_LABEL}
                stackId="monthly"
                fill={revenueColor}
                maxBarSize={36}
                radius={[3, 3, 0, 0]}
                isAnimationActive={false}
              />
              <Bar
                dataKey="costBar"
                name={COST_LABEL}
                stackId="monthly"
                fill={costColor}
                maxBarSize={36}
                radius={[3, 3, 0, 0]}
                isAnimationActive={false}
              />
              {/* 0円ライン。上=売上高/下=営業コストの境目であり、累積営業利益の黒字/赤字の境目でもある。
                  目盛り線より濃く太くし、棒の上に重ねて途切れさせない */}
              <ReferenceLine y={0} stroke={secondary} strokeWidth={1.5} />
              {/* 累積営業利益は直線で結ぶ(曲線補間は0円をまたぐ位置が実際とずれて見えるため使わない) */}
              <Line
                type="linear"
                dataKey="operatingProfit"
                name={PROFIT_LABEL}
                stroke={profitColor}
                strokeWidth={2.5}
                dot={renderDot}
                activeDot={{ r: 6, fill: profitColor, stroke: surface, strokeWidth: 2 }}
                connectNulls={false}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <p className="py-8 text-center text-sm text-[var(--text-muted)]">データがありません</p>
        )}
      </div>
      {/* 当月の値は「今日まで」ではなく、freee上で当月の日付で登録済みの仕訳すべて(先日付を含む)を
          反映した値であることを明記する(ユーザー確定、2026-10-08) */}
      <p className="text-xs text-[var(--text-muted)]">※ 当月はfreeeに登録済みの当月仕訳を反映</p>
    </div>
  );
}
