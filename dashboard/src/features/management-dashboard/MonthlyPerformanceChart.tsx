"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useCssVar } from "@/utils/useCssVar";
import { formatPercent, formatYen } from "@/utils/format";

/** グラフ1か月分。値はページ側(サーバー)で計算済みのものを受け取る。未取得はnull */
export interface PerformanceChartPoint {
  month: number;
  revenue: number | null;
  grossProfit: number | null;
  operatingProfit: number | null;
  /** 期首からこの月までの累計粗利益率(%) */
  cumulativeGrossRate: number | null;
  /** 前年同期(前期の同じ月まで)の累計粗利益率(%) */
  previousCumulativeGrossRate: number | null;
  /** 仕掛品振替が未検出の月。X軸に「*」を付ける */
  noWipTransfer: boolean;
}

const AMOUNT_SERIES = [
  { key: "revenue", label: "売上高", cssVar: "--series-1", fallback: "#2a78d6" },
  { key: "grossProfit", label: "売上総利益", cssVar: "--series-3", fallback: "#1baf7a" },
  { key: "operatingProfit", label: "営業利益", cssVar: "--series-2", fallback: "#eb6834" },
] as const;

function manYenTick(v: number): string {
  if (v === 0) return "0";
  return `${Math.round(v / 10000).toLocaleString("ja-JP")}万`;
}

function signedYen(v: number): string {
  return v < 0 ? `▲${formatYen(Math.abs(v))}` : formatYen(v);
}

function signedRate(v: number): string {
  return v < 0 ? `▲${formatPercent(Math.abs(v))}` : formatPercent(v);
}

function Swatch({ color, line = false, dashed = false }: { color: string; line?: boolean; dashed?: boolean }) {
  if (line) {
    return (
      <span
        className="inline-block w-4 shrink-0 border-t-2"
        style={{ borderColor: color, borderStyle: dashed ? "dashed" : "solid" }}
      />
    );
  }
  return <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: color }} />;
}

interface TooltipRow {
  label: string;
  color: string;
  value: string;
  line?: boolean;
  dashed?: boolean;
}

function ChartTooltip({
  active,
  payload,
  rows,
}: {
  active?: boolean;
  payload?: { payload: PerformanceChartPoint }[];
  rows: (p: PerformanceChartPoint) => TooltipRow[];
}) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0].payload;
  return (
    <div className="rounded-md border border-[var(--border-hairline)] bg-[var(--surface-1)] px-3 py-2 text-sm shadow-sm">
      <p className="mb-1 text-xs text-[var(--text-muted)]">
        {point.month}月{point.noWipTransfer && "（仕掛品振替 未検出）"}
      </p>
      {rows(point).map((r) => (
        <div key={r.label} className="flex items-center gap-2">
          <Swatch color={r.color} line={r.line} dashed={r.dashed} />
          <span className="text-[var(--text-secondary)]">{r.label}</span>
          <span className="ml-auto pl-3 font-medium tabular-nums text-[var(--text-primary)]">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * 月次業績の推移(ユーザー確定、2026-10-27)。金額と率は目盛りの単位が違うため、1枚に重ねず
 * 2枚に分ける(第2Y軸は使わない)。
 * - 左: 単月の売上高・売上総利益・営業利益(棒)
 * - 右: 累計粗利益率(当期=実線、前年同期=破線)。単月の粗利益率は仕掛品振替で大きく振れるため、累計で見せる
 */
export function MonthlyPerformanceChart({ points }: { points: PerformanceChartPoint[] }) {
  const colors = {
    revenue: useCssVar("--series-1", "#2a78d6"),
    grossProfit: useCssVar("--series-3", "#1baf7a"),
    operatingProfit: useCssVar("--series-2", "#eb6834"),
  };
  const currentRateColor = useCssVar("--series-1", "#2a78d6");
  const previousColor = useCssVar("--series-previous", "#c4c1ba");
  const gridline = useCssVar("--gridline", "#e1e0d9");
  const muted = useCssVar("--text-muted", "#898781");
  const secondary = useCssVar("--text-secondary", "#52514e");
  const baseline = useCssVar("--baseline", "#c3c2b7");
  const surface = useCssVar("--surface-1", "#fcfcfb");

  const xAxis = (
    <XAxis
      dataKey="month"
      tickFormatter={(m: number) => `${m}月${points.find((p) => p.month === m)?.noWipTransfer ? "*" : ""}`}
      stroke={muted}
      tick={{ fill: muted, fontSize: 12 }}
      axisLine={{ stroke: baseline }}
      tickLine={false}
    />
  );
  const hasNoWip = points.some((p) => p.noWipTransfer);

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-5">
      <div className="flex flex-col gap-2 rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)] p-4 lg:col-span-3">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <p className="text-xs font-medium text-[var(--text-muted)]">単月の売上高・売上総利益・営業利益</p>
          <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--text-secondary)]">
            {AMOUNT_SERIES.map((s) => (
              <li key={s.key} className="flex items-center gap-1.5">
                <Swatch color={colors[s.key]} />
                {s.label}
              </li>
            ))}
          </ul>
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={points} barGap={2} barCategoryGap="20%" margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={gridline} vertical={false} />
            {xAxis}
            <YAxis
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
                <ChartTooltip
                  rows={(p) =>
                    AMOUNT_SERIES.map((s) => ({
                      label: s.label,
                      color: colors[s.key],
                      value: p[s.key] === null ? "—" : signedYen(p[s.key] as number),
                    }))
                  }
                />
              }
            />
            {AMOUNT_SERIES.map((s) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.label}
                fill={colors[s.key]}
                stroke={surface}
                strokeWidth={1}
                maxBarSize={18}
                radius={[3, 3, 0, 0]}
                isAnimationActive={false}
              />
            ))}
            <ReferenceLine y={0} stroke={secondary} strokeWidth={1.5} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)] p-4 lg:col-span-2">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <p className="text-xs font-medium text-[var(--text-muted)]">累計粗利益率</p>
          <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--text-secondary)]">
            <li className="flex items-center gap-1.5">
              <Swatch color={currentRateColor} line />
              当期
            </li>
            <li className="flex items-center gap-1.5">
              <Swatch color={previousColor} line dashed />
              前年同期
            </li>
          </ul>
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={gridline} vertical={false} />
            {xAxis}
            <YAxis
              tickFormatter={(v: number) => `${v}%`}
              stroke={muted}
              tick={{ fill: muted, fontSize: 12 }}
              axisLine={{ stroke: baseline }}
              tickLine={false}
              width={44}
            />
            <Tooltip
              content={
                <ChartTooltip
                  rows={(p) => [
                    {
                      label: "当期",
                      color: currentRateColor,
                      line: true,
                      value: p.cumulativeGrossRate === null ? "—" : signedRate(p.cumulativeGrossRate),
                    },
                    {
                      label: "前年同期",
                      color: previousColor,
                      line: true,
                      dashed: true,
                      value: p.previousCumulativeGrossRate === null ? "—" : signedRate(p.previousCumulativeGrossRate),
                    },
                  ]}
                />
              }
            />
            <Line
              type="linear"
              dataKey="previousCumulativeGrossRate"
              name="前年同期"
              stroke={previousColor}
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={{ r: 4, fill: previousColor, stroke: surface, strokeWidth: 2 }}
              connectNulls={false}
              isAnimationActive={false}
            />
            <Line
              type="linear"
              dataKey="cumulativeGrossRate"
              name="当期"
              stroke={currentRateColor}
              strokeWidth={2}
              dot={{ r: 4, fill: currentRateColor, stroke: surface, strokeWidth: 2 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      {hasNoWip && (
        <p className="text-xs text-[var(--text-muted)] lg:col-span-5">* 仕掛品振替が未検出の月</p>
      )}
    </div>
  );
}
