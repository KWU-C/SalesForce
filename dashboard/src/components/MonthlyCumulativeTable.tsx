import type { MonthlyProgress } from "@/domain/types";
import { FISCAL_MONTH_ORDER } from "@/config/fiscalPeriods";
import { summarizePeriod } from "@/features/sales-progress/aggregate";
import { formatPercent, formatThousandYen } from "@/utils/format";

interface MonthlyCumulativeTableProps {
  title: string;
  data: MonthlyProgress[];
}

/**
 * 3ヶ月ごとのブロック＋右端に「期首からの累積」列を並べる。
 * ラベルは四半期/半期の名称を借りているが、値は常に9月始まりの累積
 * （第3四半期列も3〜5月単独ではなく9〜5月累積。ユーザー確定仕様）。
 */
const GROUP_BOUNDARIES = [3, 6, 9, 12];
const CUMULATIVE_LABELS = ["第1四半期", "上半期", "第3四半期", "通期"];

export const CUMULATIVE_GROUPS = GROUP_BOUNDARIES.map((end, i) => ({
  monthsInGroup: FISCAL_MONTH_ORDER.slice(i === 0 ? 0 : GROUP_BOUNDARIES[i - 1], end),
  cumulativeLabel: CUMULATIVE_LABELS[i],
  cumulativeMonths: FISCAL_MONTH_ORDER.slice(0, end),
}));

function statusColor(rate: number): string | undefined {
  if (rate < 0) return "var(--status-serious)";
  return undefined;
}

/** 第1四半期・上半期・第3四半期・通期の累計列に敷く背景色 */
const CUMULATIVE_COLUMN_BG = "bg-[#fdf3d0]";

function AmountCell({ value, highlight = false }: { value: number | null; highlight?: boolean }) {
  return (
    <td
      className={`px-3 py-1.5 text-right text-[var(--text-primary)] ${highlight ? CUMULATIVE_COLUMN_BG : ""}`}
    >
      {value === null ? "—" : formatThousandYen(value)}
    </td>
  );
}

function RateCell({ value, highlight = false }: { value: number | null; highlight?: boolean }) {
  return (
    <td
      className={`px-3 py-1.5 text-right font-medium ${highlight ? CUMULATIVE_COLUMN_BG : ""}`}
      style={value === null ? undefined : { color: statusColor(value) }}
    >
      {value === null ? "—" : formatPercent(value)}
    </td>
  );
}

export function MonthlyCumulativeTable({ title, data }: MonthlyCumulativeTableProps) {
  return (
    <div className="rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)]">
      <div className="flex items-baseline justify-between border-b border-[var(--border-hairline)] px-4 py-3">
        <h3 className="text-sm font-medium text-[var(--text-secondary)]">
          {title}（月別・累積）
        </h3>
        <span className="text-xs text-[var(--text-muted)]">単位：千円</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[440px] text-sm tabular-nums">
          {CUMULATIVE_GROUPS.map((group) => {
            const monthRows = group.monthsInGroup.map(
              (month) => data.find((d) => d.month === month) ?? null
            );
            const cumulative = summarizePeriod(
              group.cumulativeLabel,
              group.cumulativeMonths,
              data
            );

            return (
              <tbody
                key={group.cumulativeLabel}
                className="border-t border-[var(--border-hairline)] first:border-t-0"
              >
                <tr className="bg-[var(--gridline)] text-xs text-[var(--text-muted)]">
                  <th className="px-3 py-1.5 text-left font-normal"> </th>
                  {group.monthsInGroup.map((month) => (
                    <th key={month} className="px-3 py-1.5 text-right font-normal">
                      {month}月
                    </th>
                  ))}
                  <th
                    className={`px-3 py-1.5 text-right font-medium text-[var(--text-secondary)] ${CUMULATIVE_COLUMN_BG}`}
                  >
                    {group.cumulativeLabel}
                  </th>
                </tr>
                <tr className="border-t border-[var(--gridline)]">
                  <td className="px-3 py-1.5 text-left text-[var(--text-secondary)]">売上</td>
                  {monthRows.map((row, i) => (
                    <AmountCell key={i} value={row?.sales ?? null} />
                  ))}
                  <AmountCell value={cumulative.sales} highlight />
                </tr>
                <tr className="border-t border-[var(--gridline)]">
                  <td className="px-3 py-1.5 text-left text-[var(--text-secondary)]">粗利</td>
                  {monthRows.map((row, i) => (
                    <AmountCell key={i} value={row?.grossProfit ?? null} />
                  ))}
                  <AmountCell value={cumulative.grossProfit} highlight />
                </tr>
                <tr className="border-t border-[var(--gridline)]">
                  <td className="px-3 py-1.5 text-left text-[var(--text-secondary)]">
                    粗利達成率
                  </td>
                  {monthRows.map((row, i) => (
                    <RateCell key={i} value={row?.achievementRate ?? null} />
                  ))}
                  <RateCell value={cumulative.achievementRate} highlight />
                </tr>
              </tbody>
            );
          })}
        </table>
      </div>
    </div>
  );
}
