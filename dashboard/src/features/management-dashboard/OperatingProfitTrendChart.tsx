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

interface ChartRow {
  month: number;
  year: number;
  value: number | null;
  /** 最新月(=現在月)かどうか。ポイントを目立たせるのに使う */
  isCurrent: boolean;
}

function manYenTick(v: number): string {
  return `${Math.round(v / 10000).toLocaleString("ja-JP")}万`;
}

function TrendTooltip({
  active,
  payload,
  seriesColor,
  seriousColor,
}: {
  active?: boolean;
  payload?: { payload: ChartRow }[];
  seriesColor: string;
  seriousColor: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload;
  if (row.value === null) return null;
  return (
    <div className="rounded-md border border-[var(--border-hairline)] bg-[var(--surface-1)] px-3 py-2 text-sm shadow-sm">
      <p className="mb-1 text-xs text-[var(--text-muted)]">
        {row.year}年{row.month}月
      </p>
      <div className="flex items-center gap-2">
        <span className="inline-block h-[2px] w-3" style={{ backgroundColor: seriesColor }} />
        <span
          className={`font-medium tabular-nums ${row.value < 0 ? "" : "text-[var(--text-primary)]"}`}
          style={row.value < 0 ? { color: seriousColor } : undefined}
        >
          {formatYen(row.value)}
        </span>
        <span className="text-[var(--text-secondary)]">累計営業利益</span>
      </div>
    </div>
  );
}

/**
 * 当期累計営業利益の推移(9月〜当月)。FinancialSummaryCardsの「営業利益」カードの
 * 直下に置く補助グラフ(ユーザー確定、2026-09-22)。カード4枚より主張しないよう、
 * 単色の折れ線+0円基準線のみのシンプルな構成にする(塗りつぶし・複数系列は使わない)。
 *
 * 各月の累計営業利益カード(row.value)は、月ごとにoperatingProfitTrend.tsが
 * 既存の当期累計サマリーからそのまま読んだ値であり、最新月は上部カードと
 * 同じFinancialSummarySnapshotの値そのもの(この時点で別計算はしていない)。
 */
export function OperatingProfitTrendChart({ term, points }: OperatingProfitTrendChartProps) {
  const seriesColor = useCssVar("--series-1", "#2a78d6");
  const seriousColor = useCssVar("--status-serious", "#d03b3b");
  const gridline = useCssVar("--gridline", "#e1e0d9");
  const muted = useCssVar("--text-muted", "#898781");
  const baseline = useCssVar("--baseline", "#c3c2b7");
  const surface = useCssVar("--surface-1", "#fcfcfb");

  const data: ChartRow[] = points.map((p, i) => ({
    month: p.month,
    year: calendarYearForTermMonth(term, p.month),
    value: p.cumulativeOperatingProfit,
    isCurrent: i === points.length - 1,
  }));

  const hasData = data.some((d) => d.value !== null);

  // Y軸のドメインを明示的に決める。データ点が1つ(または全月が近い値)しかない場合、
  // recharts任せだと目盛りが同じ丸め値で並んでしまう(例: 「-120万」が5回続く)ため、
  // 0を含む範囲に余白を持たせて必ず複数の異なる目盛りが出るようにする(ユーザー確定、2026-09-22)。
  const values = data.map((d) => d.value).filter((v): v is number => v !== null);
  const rawMin = Math.min(0, ...values);
  const rawMax = Math.max(0, ...values);
  const pad = Math.max((rawMax - rawMin) * 0.25, 500_000);
  const yDomain: [number, number] = [rawMin - pad, rawMax + pad];

  function renderDot(props: unknown) {
    const { cx, cy, payload } = props as { cx?: number; cy?: number; payload?: ChartRow };
    if (cx === undefined || cy === undefined || !payload || payload.value === null) return <g key={`d-${payload?.month}`} />;
    const r = payload.isCurrent ? 6 : 4;
    return (
      <circle
        key={`d-${payload.month}`}
        cx={cx}
        cy={cy}
        r={r}
        fill={seriesColor}
        stroke={surface}
        strokeWidth={2}
      />
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium text-[var(--text-muted)]">累計営業利益の推移</p>
      <div className="rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)] p-4">
        {hasData ? (
          <ResponsiveContainer width="100%" height={220}>
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
                tickFormatter={manYenTick}
                stroke={muted}
                tick={{ fill: muted, fontSize: 12 }}
                axisLine={{ stroke: baseline }}
                tickLine={false}
                width={56}
              />
              <ReferenceLine y={0} stroke={muted} strokeWidth={1} />
              <Tooltip content={<TrendTooltip seriesColor={seriesColor} seriousColor={seriousColor} />} />
              <Line
                type="monotone"
                dataKey="value"
                stroke={seriesColor}
                strokeWidth={2}
                dot={renderDot}
                activeDot={{ r: 6, fill: seriesColor, stroke: surface, strokeWidth: 2 }}
                connectNulls={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <p className="py-8 text-center text-sm text-[var(--text-muted)]">データがありません</p>
        )}
      </div>
    </div>
  );
}
