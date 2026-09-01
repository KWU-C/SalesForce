import { Fragment } from "react";
import type { CrProgress } from "@/domain/types";
import {
  buildCrossCrProgress,
  getCrossCrList,
  type CrossCrColumn,
} from "@/features/sales-progress/crossCrProgress";
import { formatPercent2, formatPercentInt, formatThousandYen } from "@/utils/format";

interface CrossCrProgressTableProps {
  progressByCr: CrProgress[];
  currentMonth: number;
  term: number;
}

function statusColor(rate: number): string | undefined {
  if (rate < 100) return "var(--status-serious)";
  return undefined;
}

function CrCells({ col, cumulativeBg }: { col: CrossCrColumn; cumulativeBg: string }) {
  return (
    <>
      <td className="border-l-2 border-[var(--baseline)] px-2 py-1.5 text-right text-[var(--text-secondary)]">
        {formatThousandYen(col.targetGrossProfit)}
      </td>
      <td className="border-l border-[var(--gridline)] px-2 py-1.5 text-right text-[var(--text-primary)]">
        {col.orderGrossProfit === null ? "—" : formatThousandYen(col.orderGrossProfit)}
      </td>
      <td
        className="px-2 py-1.5 text-right"
        style={col.orderMonthlyRate === null ? undefined : { color: statusColor(col.orderMonthlyRate) }}
      >
        {col.orderMonthlyRate === null ? "—" : formatPercent2(col.orderMonthlyRate)}
      </td>
      <td
        className={`px-2 py-1.5 text-right font-semibold ${cumulativeBg}`}
        style={
          col.orderCumulativeRate === null ? undefined : { color: statusColor(col.orderCumulativeRate) }
        }
      >
        {col.orderCumulativeRate === null ? "—" : formatPercentInt(col.orderCumulativeRate)}
      </td>
      <td className="border-l border-[var(--gridline)] px-2 py-1.5 text-right text-[var(--text-primary)]">
        {col.completedGrossProfit === null ? "—" : formatThousandYen(col.completedGrossProfit)}
      </td>
      <td
        className="px-2 py-1.5 text-right"
        style={
          col.completedMonthlyRate === null ? undefined : { color: statusColor(col.completedMonthlyRate) }
        }
      >
        {col.completedMonthlyRate === null ? "—" : formatPercent2(col.completedMonthlyRate)}
      </td>
      <td
        className={`px-2 py-1.5 text-right font-semibold ${cumulativeBg}`}
        style={
          col.completedCumulativeRate === null
            ? undefined
            : { color: statusColor(col.completedCumulativeRate) }
        }
      >
        {col.completedCumulativeRate === null ? "—" : formatPercentInt(col.completedCumulativeRate)}
      </td>
    </>
  );
}

/**
 * CR1・CR2・CR3を横方向に並べたCR横断進捗表。上部のCRタブ(全社/CR1/CR2/CR3)の
 * 選択状態には連動しない（常にCR1〜CR3を横断して1枚だけ表示する）。
 * データはprogressByCrをそのまま渡し、表専用のSalesforce取得・集計は行わない
 * （features/sales-progress/crossCrProgress.tsで既存のsummarizePeriodを再利用）。
 */
export function CrossCrProgressTable({ progressByCr, currentMonth, term }: CrossCrProgressTableProps) {
  const { monthRows, totalRow } = buildCrossCrProgress(progressByCr, currentMonth, term);
  const crossCrList = getCrossCrList(term);

  return (
    <div className="rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)]">
      <div className="flex items-baseline justify-between border-b border-[var(--border-hairline)] px-4 py-3">
        <h3 className="text-sm font-medium text-[var(--text-secondary)]">CR横断 月次・累積進捗</h3>
        <span className="text-xs text-[var(--text-muted)]">単位：千円</span>
      </div>
      <div className="overflow-x-auto">
        <table className="text-sm tabular-nums">
          <thead>
            <tr>
              <th
                rowSpan={2}
                className="sticky left-0 z-10 bg-[var(--surface-1)] px-3 py-1.5 text-left font-normal text-[var(--text-muted)]"
              >
                月
              </th>
              {crossCrList.map((cr) => (
                <th
                  key={cr.id}
                  colSpan={7}
                  className="border-l-2 border-[var(--baseline)] px-2 py-1.5 text-center font-medium text-[var(--text-secondary)]"
                >
                  {cr.label}
                </th>
              ))}
            </tr>
            <tr className="text-xs text-[var(--text-muted)]">
              {crossCrList.map((cr) => (
                <Fragment key={cr.id}>
                  <th className="border-l-2 border-[var(--baseline)] px-2 py-1 text-right font-normal">
                    目標
                  </th>
                  <th className="border-l border-[var(--gridline)] px-2 py-1 text-right font-normal text-[var(--series-1)]">
                    受注
                  </th>
                  <th className="px-2 py-1 text-right font-normal text-[var(--series-1)]">達成率</th>
                  <th className="px-2 py-1 text-right font-semibold text-[var(--series-1)]">累計</th>
                  <th className="border-l border-[var(--gridline)] px-2 py-1 text-right font-normal text-[var(--series-2)]">
                    完了
                  </th>
                  <th className="px-2 py-1 text-right font-normal text-[var(--series-2)]">達成率</th>
                  <th className="px-2 py-1 text-right font-semibold text-[var(--series-2)]">累計</th>
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {monthRows.map((row, i) => {
              const zebra = i % 2 === 0;
              const rowBg = zebra ? "bg-[var(--gridline)]/50" : "";
              const stickyBg = zebra ? "bg-[var(--gridline)]/50" : "bg-[var(--surface-1)]";
              // 帯色のある行(9月/11月/...)は少し濃いめ、白地の行(10月/12月/...)は薄めのクリーム色
              const cumulativeBg = zebra ? "bg-[#ece2bf]" : "bg-[#fdf3d0]";

              return (
                <tr key={row.month} className={`border-t border-[var(--gridline)] ${rowBg}`}>
                  <td
                    className={`sticky left-0 z-10 px-3 py-1.5 text-left font-medium text-[var(--text-primary)] ${stickyBg}`}
                  >
                    {row.month}月
                  </td>
                  {row.columns.map((col) => (
                    <CrCells key={col.crId} col={col} cumulativeBg={cumulativeBg} />
                  ))}
                </tr>
              );
            })}
            <tr className="border-t-2 border-[var(--baseline)] bg-[var(--gridline)]/50 font-medium">
              <td className="sticky left-0 z-10 bg-[var(--gridline)]/50 px-3 py-1.5 text-left text-[var(--text-primary)]">
                合計
              </td>
              {totalRow.map((col) => (
                <CrCells key={col.crId} col={col} cumulativeBg="bg-[#ece2bf]" />
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
