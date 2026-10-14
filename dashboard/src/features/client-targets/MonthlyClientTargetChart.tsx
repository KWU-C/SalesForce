"use client";

import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useCssVar } from "@/utils/useCssVar";
import { formatYen } from "@/utils/format";
import { ChartTooltip } from "@/features/dashboard/charts/ChartTooltip";
import type { MonthlyClientTargetPoint } from "./clientTargets";

function yenAxisTick(v: number): string {
  return `${Math.round(v / 10000).toLocaleString("ja-JP")}万`;
}

/**
 * 月次推移(受注粗利・完了粗利の棒＋月次目標の点線)。色の割り当て(受注=series-1、完了=series-2、
 * 目標=series-3)と体裁は営業進捗タブのPeriodComparisonChartに揃える。同じ円単位の1軸のみ。
 */
export function MonthlyClientTargetChart({ monthly }: { monthly: MonthlyClientTargetPoint[] }) {
  const seriesOrder = useCssVar("--series-1", "#2a78d6");
  const seriesCompleted = useCssVar("--series-2", "#eb6834");
  const seriesTarget = useCssVar("--series-3", "#1baf7a");
  const gridline = useCssVar("--gridline", "#e1e0d9");
  const muted = useCssVar("--text-muted", "#898781");
  const baseline = useCssVar("--baseline", "#c3c2b7");
  const secondary = useCssVar("--text-secondary", "#52514e");

  const data = monthly.map((m) => ({
    month: m.month,
    受注粗利: m.order,
    完了粗利: m.completed,
    月次目標: m.target,
  }));

  return (
    <div className="rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)] p-4">
      <h3 className="mb-3 text-sm font-medium text-[var(--text-secondary)]">月次推移（粗利）</h3>
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
          <Tooltip content={(props) => <ChartTooltip {...props} valueFormatter={formatYen} />} />
          <Legend wrapperStyle={{ fontSize: 12, color: secondary }} />
          <Bar dataKey="受注粗利" fill={seriesOrder} radius={[4, 4, 0, 0]} />
          <Bar dataKey="完了粗利" fill={seriesCompleted} radius={[4, 4, 0, 0]} />
          <Line type="monotone" dataKey="月次目標" stroke={seriesTarget} strokeWidth={2} strokeDasharray="4 4" dot={{ r: 3 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
