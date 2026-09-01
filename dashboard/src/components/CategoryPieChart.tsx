"use client";

import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { useCssVar } from "@/utils/useCssVar";
import { formatYen } from "@/utils/format";
import type { CategorySlice } from "@/features/sales-progress/categoryChart";

interface CategoryPieChartProps {
  title: string;
  slices: CategorySlice[];
  /** CR別の横並び用（小さめ・凡例なし）。省略時は全社用（大きめ・凡例あり） */
  compact?: boolean;
}

interface PieTooltipEntry {
  name?: string;
  value?: number;
  color?: string;
}

function CategoryPieTooltip({ active, payload }: { active?: boolean; payload?: PieTooltipEntry[] }) {
  if (!active || !payload || payload.length === 0) return null;
  const entry = payload[0];

  return (
    <div className="rounded-md border border-[var(--border-hairline)] bg-[var(--surface-1)] px-3 py-2 text-sm shadow-sm">
      <div className="flex items-center gap-2">
        <span
          className="inline-block h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: entry.color }}
        />
        <span className="text-[var(--text-secondary)]">{entry.name}</span>
      </div>
      <p className="mt-1 font-medium tabular-nums text-[var(--text-primary)]">
        {typeof entry.value === "number" ? formatYen(entry.value) : entry.value}
      </p>
    </div>
  );
}

export function CategoryPieChart({ title, slices, compact = false }: CategoryPieChartProps) {
  const categoryColor1 = useCssVar("--series-category-1", "#00b5be");
  const categoryColor2 = useCssVar("--series-category-2", "#a892f4");
  const categoryColor3 = useCssVar("--series-category-3", "#416e29");
  const categoryColor4 = useCssVar("--series-category-4", "#c4606c");
  const categoryColor5 = useCssVar("--series-category-5", "#c7ac41");
  const otherColor = useCssVar("--series-other", "#c9c7bf");
  const surface = useCssVar("--surface-1", "#fcfcfb");
  const secondary = useCssVar("--text-secondary", "#52514e");

  const colorByVar: Record<CategorySlice["colorVar"], string> = {
    "--series-category-1": categoryColor1,
    "--series-category-2": categoryColor2,
    "--series-category-3": categoryColor3,
    "--series-category-4": categoryColor4,
    "--series-category-5": categoryColor5,
    "--series-other": otherColor,
  };

  const total = slices.reduce((sum, s) => sum + s.grossProfit, 0);
  const data = slices.map((s) => ({
    name: s.category,
    value: s.grossProfit,
    color: colorByVar[s.colorVar],
  }));

  const size = compact ? 140 : 240;
  const outerRadius = compact ? 60 : 100;
  // 凡例(最大6項目、折り返しで2〜3行になる)がPie本体と重ならないよう、
  // 非compact(凡例あり)の場合だけコンテナを高くして下に専用スペースを確保する。
  // 円の直径・中心位置はそのまま(cyを上に詰めるだけ)にする
  const legendReservedHeight = compact ? 0 : 72;
  const containerHeight = size + legendReservedHeight;
  const pieCy = compact ? "50%" : `${((size / 2) / containerHeight) * 100}%`;

  return (
    <div className="flex flex-col items-center gap-2">
      <h4
        className={
          compact
            ? "text-xs font-medium text-[var(--text-secondary)]"
            : "text-sm font-medium text-[var(--text-secondary)]"
        }
      >
        {title}
      </h4>
      {total === 0 ? (
        <div
          className="flex items-center justify-center text-xs text-[var(--text-muted)]"
          style={{ width: size, height: containerHeight }}
        >
          データなし
        </div>
      ) : (
        <ResponsiveContainer width={size} height={containerHeight}>
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              cy={pieCy}
              outerRadius={outerRadius}
              stroke={surface}
              strokeWidth={2}
              // Recharts 3のPie既定(isAnimationActive="auto")は、タブが非フォーカスで
              // requestAnimationFrameが回らない環境(自動テスト等)だと入場アニメーションが
              // 開始角のまま進まず扇形が一切描画されない不具合を実機で確認したため無効化
              isAnimationActive={false}
            >
              {data.map((d, i) => (
                <Cell key={i} fill={d.color} />
              ))}
            </Pie>
            <Tooltip content={<CategoryPieTooltip />} />
            {!compact && <Legend wrapperStyle={{ fontSize: 12, color: secondary }} />}
          </PieChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
