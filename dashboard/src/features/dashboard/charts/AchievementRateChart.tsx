"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { MonthlyProgress } from "@/domain/types";
import { useCssVar } from "@/utils/useCssVar";
import { formatPercent } from "@/utils/format";
import { ChartTooltip } from "./ChartTooltip";

interface AchievementRateChartProps {
  order: MonthlyProgress[];
  completed: MonthlyProgress[];
}

export function AchievementRateChart({
  order,
  completed,
}: AchievementRateChartProps) {
  const seriesOrder = useCssVar("--series-1", "#2a78d6");
  const seriesCompleted = useCssVar("--series-2", "#eb6834");
  const gridline = useCssVar("--gridline", "#e1e0d9");
  const muted = useCssVar("--text-muted", "#898781");
  const baseline = useCssVar("--baseline", "#c3c2b7");
  const secondary = useCssVar("--text-secondary", "#52514e");

  const data = order.map((row, i) => ({
    month: row.month,
    受注達成率: row.achievementRate,
    完了達成率: completed[i].achievementRate,
  }));

  return (
    <div className="rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)] p-4">
      <h3 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">
        月別粗利達成率
      </h3>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
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
            tickFormatter={(v) => `${v}%`}
            stroke={muted}
            tick={{ fill: muted, fontSize: 12 }}
            axisLine={{ stroke: baseline }}
            tickLine={false}
            width={48}
          />
          <ReferenceLine
            y={100}
            stroke={baseline}
            strokeDasharray="4 4"
            label={{
              value: "目標100%",
              position: "insideTopRight",
              fill: secondary,
              fontSize: 12,
            }}
          />
          <Tooltip
            content={(props) => (
              <ChartTooltip {...props} valueFormatter={formatPercent} />
            )}
          />
          <Legend wrapperStyle={{ fontSize: 12, color: secondary }} />
          <Line
            type="monotone"
            dataKey="受注達成率"
            stroke={seriesOrder}
            strokeWidth={2}
            dot={{ r: 4 }}
            connectNulls
          />
          <Line
            type="monotone"
            dataKey="完了達成率"
            stroke={seriesCompleted}
            strokeWidth={2}
            dot={{ r: 4 }}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
