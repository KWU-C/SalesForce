"use client";

import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { calendarYearForTermMonth } from "@/config/fiscalPeriods";
import { useCssVar } from "@/utils/useCssVar";
import { formatYen } from "@/utils/format";
import type { OperatingProfitTrendPoint } from "./operatingProfitTrend";

interface OperatingProfitTrendChartProps {
  term: number;
  points: OperatingProfitTrendPoint[];
}

type SeriesKey = "revenue" | "grossProfit" | "operatingProfit";

interface ChartRow {
  month: number;
  year: number;
  revenue: number | null;
  grossProfit: number | null;
  operatingProfit: number | null;
  /** 最新月(=現在月)かどうか。ポイントを目立たせるのに使う */
  isCurrent: boolean;
}

interface SeriesDef {
  key: SeriesKey;
  label: string;
  color: string;
}

function manYenTick(v: number): string {
  if (v === 0) return "0";
  return `${Math.round(v / 10000).toLocaleString("ja-JP")}万`;
}

/**
 * 0を必ず含む、きりの良い等間隔のY軸目盛りを作る。recharts任せだと0が目盛りに
 * 乗らないことがあり、0円ライン(黒字化の境目)が読み取りにくくなるため明示的に決める。
 * データ点が1つ(または全月が近い値)しかない場合も、必ず複数の異なる目盛りが出る
 * (同じ丸め値が並ばない、ユーザー確定、2026-09-22)。
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

function TrendTooltip({
  active,
  payload,
  series,
  seriousColor,
}: {
  active?: boolean;
  payload?: { payload: ChartRow }[];
  series: SeriesDef[];
  seriousColor: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload;
  const rows = series.filter((s) => row[s.key] !== null);
  if (rows.length === 0) return null;
  return (
    <div className="rounded-md border border-[var(--border-hairline)] bg-[var(--surface-1)] px-3 py-2 text-sm shadow-sm">
      <p className="mb-1 text-xs text-[var(--text-muted)]">
        {row.year}年{row.month}月（期首からの累計）
      </p>
      <div className="flex flex-col gap-0.5">
        {rows.map((s) => {
          const value = row[s.key] as number;
          return (
            <div key={s.key} className="flex items-center gap-2">
              <span className="inline-block h-[2px] w-3 shrink-0" style={{ backgroundColor: s.color }} />
              <span className="text-[var(--text-secondary)]">{s.label}</span>
              <span
                className={`ml-auto pl-3 font-medium tabular-nums ${value < 0 ? "" : "text-[var(--text-primary)]"}`}
                style={value < 0 ? { color: seriousColor } : undefined}
              >
                {formatYen(value)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * 事業収支の推移(9月〜当月の当期累計)。売上高→粗利益→営業利益の3段階を同じグラフ・
 * 同じ軸に重ね、「どれだけ売上を作り、どれだけ粗利を残し、最終的に営業利益がどうなったか」
 * を月次累計で見比べられるようにする(ユーザー確定、2026-10-08)。経常利益・目標・前期比較・
 * 粗利率・原価/販管費の独立系列は載せない。
 *
 * 各月の値は、operatingProfitTrend.tsが既存の当期累計サマリーからそのまま読んだ値であり、
 * 最新月は上部カードと同じFinancialSummarySnapshotの値そのもの(ここで別計算はしていない)。
 * 欠損月(null)は線をつながず、補間もしない。
 */
export function OperatingProfitTrendChart({ term, points }: OperatingProfitTrendChartProps) {
  const revenueColor = useCssVar("--series-1", "#2a78d6");
  const grossProfitColor = useCssVar("--series-2", "#eb6834");
  const operatingProfitColor = useCssVar("--series-3", "#1baf7a");
  const seriousColor = useCssVar("--status-serious", "#d03b3b");
  const gridline = useCssVar("--gridline", "#e1e0d9");
  const muted = useCssVar("--text-muted", "#898781");
  const secondary = useCssVar("--text-secondary", "#52514e");
  const baseline = useCssVar("--baseline", "#c3c2b7");
  const surface = useCssVar("--surface-1", "#fcfcfb");

  // 並び順=事業収支の流れ(売上高→粗利益→営業利益)。凡例・ツールチップも同じ順で出す
  const series: SeriesDef[] = [
    { key: "revenue", label: "売上高", color: revenueColor },
    { key: "grossProfit", label: "粗利益", color: grossProfitColor },
    { key: "operatingProfit", label: "営業利益", color: operatingProfitColor },
  ];

  const data: ChartRow[] = points.map((p, i) => ({
    month: p.month,
    year: calendarYearForTermMonth(term, p.month),
    revenue: p.cumulativeRevenue,
    grossProfit: p.cumulativeGrossProfit,
    operatingProfit: p.cumulativeOperatingProfit,
    isCurrent: i === points.length - 1,
  }));

  const values = data.flatMap((d) => series.map((s) => d[s.key])).filter((v): v is number => v !== null);
  const hasData = values.length > 0;
  const yTicks = yTicksIncludingZero(values);
  const yDomain: [number, number] = [yTicks[0], yTicks[yTicks.length - 1]];

  function renderDot(s: SeriesDef) {
    return function Dot(props: unknown) {
      const { cx, cy, payload } = props as { cx?: number; cy?: number; payload?: ChartRow };
      if (cx === undefined || cy === undefined || !payload || payload[s.key] === null) {
        return <g key={`d-${s.key}-${payload?.month}`} />;
      }
      return (
        <circle
          key={`d-${s.key}-${payload.month}`}
          cx={cx}
          cy={cy}
          r={payload.isCurrent ? 6 : 4}
          fill={s.color}
          stroke={surface}
          strokeWidth={2}
        />
      );
    };
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <p className="text-xs font-medium text-[var(--text-muted)]">事業収支の推移</p>
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--text-secondary)]">
          {series.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span className="relative inline-block h-[2px] w-4" style={{ backgroundColor: s.color }}>
                <span
                  className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full"
                  style={{ backgroundColor: s.color }}
                />
              </span>
              {s.label}
            </li>
          ))}
        </ul>
      </div>
      <div className="rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)] p-4">
        {hasData ? (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={gridline} vertical={false} />
              <XAxis
                dataKey="month"
                tickFormatter={(m: number) => `${m}月`}
                stroke={muted}
                tick={{ fill: muted, fontSize: 12 }}
                axisLine={{ stroke: baseline }}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                domain={yDomain}
                ticks={yTicks}
                tickFormatter={manYenTick}
                stroke={muted}
                tick={{ fill: muted, fontSize: 12 }}
                axisLine={{ stroke: baseline }}
                tickLine={false}
                width={60}
              />
              {/* 0円ライン。粗利益・営業利益がいつ黒字化したかを読み取りやすいよう、目盛り線より濃く太くする */}
              <ReferenceLine y={0} stroke={secondary} strokeWidth={1.5} />
              <Tooltip content={<TrendTooltip series={series} seriousColor={seriousColor} />} />
              {series.map((s) => (
                <Line
                  key={s.key}
                  type="linear"
                  dataKey={s.key}
                  name={s.label}
                  stroke={s.color}
                  strokeWidth={2}
                  dot={renderDot(s)}
                  activeDot={{ r: 6, fill: s.color, stroke: surface, strokeWidth: 2 }}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <p className="py-8 text-center text-sm text-[var(--text-muted)]">データがありません</p>
        )}
      </div>
    </div>
  );
}
