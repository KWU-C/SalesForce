"use client";

import type { TooltipContentProps } from "recharts";

export function ChartTooltip({
  active,
  payload,
  label,
  valueFormatter,
}: TooltipContentProps & {
  valueFormatter: (v: number) => string;
}) {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div className="rounded-md border border-[var(--border-hairline)] bg-[var(--surface-1)] px-3 py-2 text-sm shadow-sm">
      <p className="mb-1 text-xs text-[var(--text-muted)]">{label}月</p>
      {payload.map((entry, i) => (
        <div key={i} className="flex items-center gap-2">
          <span
            className="inline-block h-[2px] w-3"
            style={{ backgroundColor: entry.color }}
          />
          <span className="font-medium tabular-nums text-[var(--text-primary)]">
            {typeof entry.value === "number"
              ? valueFormatter(entry.value)
              : entry.value}
          </span>
          <span className="text-[var(--text-secondary)]">{entry.name}</span>
        </div>
      ))}
    </div>
  );
}
