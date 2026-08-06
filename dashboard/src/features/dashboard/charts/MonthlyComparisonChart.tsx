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

interface MonthlyComparisonChartProps {
  order: MonthlyProgress[];
  completed: MonthlyProgress[];
}

function yenAxisTick(v: number): string {
  return `${Math.round(v / 10000).toLocaleString("ja-JP")}万`;
}

export function MonthlyComparisonChart({
  order,
  completed,
}: MonthlyComparisonChartProps) {
  const seriesOrder = useCssVar("--series-1", "#2a78d6");
  const seriesCompleted = useCssVar("--series-2", "#eb6834");
  const seriesTarget = useCssVar("--series-3", "#1baf7a");
  const gridline = useCssVar("--gridline", "#e1e0d9");
  const muted = useCssVar("--text-muted", "#898781");
  const baseline = useCssVar("--baseline", "#c3c2b7");
  const secondary = useCssVar("--text-secondary", "#52514e");

  const data = order.map((row, i) => ({
    month: row.month,
    受注: row.grossProfit,
    完了: completed[i].grossProfit,
    目標: row.targetGrossProfit,
  }));

  return (
    <div className="rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)] p-4">
      <h3 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">
        月別粗利：受注／完了／目標比較
      </h3>
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
          <Bar dataKey="受注" fill={seriesOrder} radius={[4, 4, 0, 0]} />
          <Bar dataKey="完了" fill={seriesCompleted} radius={[4, 4, 0, 0]} />
          <Line
            type="monotone"
            dataKey="目標"
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
