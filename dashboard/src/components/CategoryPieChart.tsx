"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
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
  const legendWidth = 150;

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
          style={{ width: size, height: size }}
        >
          データなし
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <ResponsiveContainer width={size} height={size}>
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                nameKey="name"
                outerRadius={outerRadius}
                // 12時位置(真上)から時計回りに開始する(業務資料の円グラフの慣例に合わせる、
                // ユーザー確定2026-09-01)。Rechartsの角度は3時位置=0°・反時計回りが正なので、
                // 12時=90°から開始し、終角を-270°(=90-360)にして時計回りへ反転させる
                startAngle={90}
                endAngle={-270}
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
            </PieChart>
          </ResponsiveContainer>
          {!compact && (
            // Rechartsの<Legend>はPieの並び順を保持せず表示順が崩れることがあるため
            // (実機確認2026-09-01)、順位1〜6の並びを保証できる自前の凡例を右側に置く
            <ul className="flex flex-col gap-1" style={{ width: legendWidth }}>
              {data.map((d, i) => (
                <li key={i} className="flex items-center gap-1.5 text-xs">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: d.color }}
                  />
                  <span className="truncate text-[var(--text-secondary)]">{d.name}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
