"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { MonthlyProgress } from "@/domain/types";
import { useCssVar } from "@/utils/useCssVar";
import { formatYen } from "@/utils/format";
import { ChartTooltip } from "./ChartTooltip";

interface PeriodComparisonChartProps {
  title: string;
  current: MonthlyProgress[];
  previous: MonthlyProgress[];
  /** 今期バーの色に使うCSS変数名（--series-1=受注, --series-2=完了） */
  currentColorVar: "--series-1" | "--series-2";
}

function yenAxisTick(v: number): string {
  return `${Math.round(v / 10000).toLocaleString("ja-JP")}万`;
}

export function PeriodComparisonChart({
  title,
  current,
  previous,
  currentColorVar,
}: PeriodComparisonChartProps) {
  const seriesCurrent = useCssVar(currentColorVar, "#2a78d6");
  const seriesPrevious = useCssVar("--text-muted", "#898781");
  const seriesTarget = useCssVar("--series-3", "#1baf7a");
  const gridline = useCssVar("--gridline", "#e1e0d9");
  const muted = useCssVar("--text-muted", "#898781");
  const baseline = useCssVar("--baseline", "#c3c2b7");
  const secondary = useCssVar("--text-secondary", "#52514e");

  const data = current.map((row, i) => ({
    month: row.month,
    前期: previous[i]?.grossProfit ?? null,
    今期: row.grossProfit,
    月次目標: row.targetGrossProfit,
  }));

  return (
    <div className="rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)] p-4">
      <h3 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">{title}</h3>
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={gridline} vertical={false} />
          <XAxis
            dataKey="month"
            tickFormatter={(m) => `${m}月`}
            stroke={muted}
            tick={{ fill: muted, fontSize: 12 }}
            axisLine={{ stroke: baseline }}
            tickLine={false}
          />
          <YAxis
            tickFormatter={yenAxisTick}
            stroke={muted}
            tick={{ fill: muted, fontSize: 12 }}
            axisLine={{ stroke: baseline }}
            tickLine={false}
            width={56}
          />
          <Tooltip
            content={(props) => (
              <ChartTooltip {...props} valueFormatter={formatYen} />
            )}
          />
          <Legend wrapperStyle={{ fontSize: 12, color: secondary }} />
          <Bar dataKey="前期" fill={seriesPrevious} radius={[4, 4, 0, 0]} />
          <Bar dataKey="今期" fill={seriesCurrent} radius={[4, 4, 0, 0]} />
          <Line
            type="monotone"
            dataKey="月次目標"
            stroke={seriesTarget}
            strokeWidth={2}
            strokeDasharray="4 4"
            dot={{ r: 3 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
