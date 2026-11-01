import { Fragment } from "react";
import type { CrProgress } from "@/domain/types";
import {
  buildCrossCrProgress,
  getCrossCrList,
  type CrossCrColumn,
} from "@/features/sales-progress/crossCrProgress";
import { formatThousandYen } from "@/utils/format";

/** この表の%は小数点以下を切り捨てて整数で出す(達成率・累計とも、ユーザー確定2026-11-01)。
 * マイナスは0側へ切り捨てる(-3.4%→-3%) */
function truncPercent(rate: number): number {
  return Math.trunc(rate) || 0; // -0を0にする
}

function formatPercentTrunc(rate: number): string {
  return `${truncPercent(rate)}%`;
}

interface CrossCrProgressTableProps {
  progressByCr: CrProgress[];
  currentMonth: number;
  term: number;
}

function statusColor(rate: number): string | undefined {
  if (rate < 100) return "var(--status-serious)";
  return undefined;
}

type Series = "target" | "order" | "completed";

interface MetricRow {
  key: string;
  label: string;
  series: Series;
  /** 受注・完了(金額)行。クリーム色の帯・太字・天地130%で強調する
   * (ユーザー確定2026-11-01: 以前は達成率行を強調していたが入れ替え) */
  highlight?: boolean;
  /** 受注・完了ブロックの先頭行。上に区切り線を入れる */
  blockStart?: boolean;
  render: (col: CrossCrColumn) => { text: string; color?: string };
  /** 達成率セル内に小さくグレーで添える累計(%)。「累計 19%」の形で出す */
  cumulative?: (col: CrossCrColumn) => number | null;
}

function amount(v: number | null) {
  return { text: v === null ? "—" : formatThousandYen(v) };
}

function monthlyRate(v: number | null) {
  // 赤字判定も表示値(切り捨て後)に揃える(99.6%→99%は赤)
  return v === null ? { text: "—" } : { text: formatPercentTrunc(v), color: statusColor(truncPercent(v)) };
}


const METRIC_ROWS: MetricRow[] = [
  { key: "target", label: "目標", series: "target", render: (c) => amount(c.targetGrossProfit) },
  {
    key: "order",
    label: "受注",
    highlight: true,
    series: "order",
    blockStart: true,
    render: (c) => amount(c.orderGrossProfit),
  },
  {
    key: "orderMonthlyRate",
    label: "達成率",
    series: "order",
    render: (c) => monthlyRate(c.orderMonthlyRate),
    cumulative: (c) => c.orderCumulativeRate,
  },
  {
    key: "completed",
    label: "完了",
    highlight: true,
    series: "completed",
    blockStart: true,
    render: (c) => amount(c.completedGrossProfit),
  },
  {
    key: "completedMonthlyRate",
    label: "達成率",
    series: "completed",
    render: (c) => monthlyRate(c.completedMonthlyRate),
    cumulative: (c) => c.completedCumulativeRate,
  },
];

const SERIES_LABEL_COLOR: Record<Series, string> = {
  target: "text-[var(--text-secondary)]",
  order: "text-[var(--series-1)]",
  completed: "text-[var(--series-2)]",
};

/**
 * 色の付け方は縦横入れ替え前の表を踏襲する。月ごとにベース色(帯)を入れる/入れないを交互にし、
 * 受注・完了の行はクリーム色の帯を横断して敷く。帯色のある月(9月/11月/...)は濃いめ、
 * 白地の月(10月/12月/...)は薄めのクリーム色。合計列は帯色あり扱い。
 */
/** 達成率セル内の累計表示(小さい文字・グレー、数字のみ。「累計」の見出しは項目列に1回だけ出す。
 * design_sample.jpgに合わせる、ユーザー確定2026-11-01) */
function CumulativeNote({ value }: { value: number | null }) {
  return (
    <div className="text-[10px] font-normal leading-tight text-[var(--text-secondary)]">
      {value === null ? "—" : formatPercentTrunc(value)}
    </div>
  );
}

const MONTH_BAND_BG = "bg-[var(--gridline)]/50";
function cellBackground(banded: boolean, highlight: boolean | undefined): string {
  if (highlight) return banded ? "bg-[#ece2bf]" : "bg-[#fdf3d0]";
  return banded ? MONTH_BAND_BG : "";
}

/**
 * CR1・CR2・CR3(50期以降はCR4まで)を縦方向に並べたCR横断進捗表。
 * 縦軸=CR×項目(目標/受注/達成率(累計を内包)/完了/達成率(累計を内包))、横軸=月(9月〜8月)+合計。
 * 上部のCRタブ(全社/CR1/CR2/CR3)の選択状態には連動しない（常にCR横断で1枚だけ表示する）。
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
            <tr className="text-xs text-[var(--text-muted)]">
              <th className="sticky left-0 z-10 bg-[var(--surface-1)] px-3 py-1.5 text-left font-normal">
                CR
              </th>
              <th className="sticky left-[3.5rem] z-10 bg-[var(--surface-1)] px-3 py-1.5 text-left font-normal">
                項目
              </th>
              {monthRows.map((row, monthIndex) => (
                <th
                  key={row.month}
                  className={`px-2 py-1.5 text-right font-medium ${monthIndex % 2 === 0 ? MONTH_BAND_BG : ""} ${
                    row.isCurrentMonth ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]"
                  }`}
                >
                  {row.month}月
                </th>
              ))}
              <th className={`border-l-2 border-[var(--baseline)] px-2 py-1.5 text-right font-medium text-[var(--text-secondary)] ${MONTH_BAND_BG}`}>
                合計
              </th>
            </tr>
          </thead>
          <tbody>
            {crossCrList.map((cr, crIndex) => {
              const stickyBg = "bg-[var(--surface-1)]";
              return (
                <Fragment key={cr.id}>
                  {METRIC_ROWS.map((metric, metricIndex) => {
                    const rowBorder =
                      metricIndex === 0
                        ? "border-t-2 border-[var(--baseline)]"
                        : metric.blockStart
                          ? "border-t border-[var(--baseline)]"
                          : "";
                    const cellWeight = metric.highlight ? "font-semibold" : "";
                    // 受注・完了行は天地130%(py-1.5の行≒32pxに対し≒42px)
                    const cellPy = metric.highlight ? "py-[11px]" : "py-1.5";
                    const totalCol = totalRow[crIndex];
                    const total = metric.render(totalCol);
                    return (
                      <tr key={metric.key} className={rowBorder}>
                        {metricIndex === 0 && (
                          <td
                            rowSpan={METRIC_ROWS.length}
                            className={`sticky left-0 z-10 w-[3.5rem] min-w-[3.5rem] px-3 py-1.5 align-top font-medium text-[var(--text-primary)] ${stickyBg}`}
                          >
                            {cr.label}
                          </td>
                        )}
                        <td
                          className={`sticky left-[3.5rem] z-10 whitespace-nowrap px-3 ${cellPy} text-left text-xs ${
                            metric.blockStart ? "font-semibold" : "font-normal"
                          } ${SERIES_LABEL_COLOR[metric.series]} ${stickyBg}`}
                        >
                          {metric.label}
                          {metric.cumulative && (
                            <div className="text-[10px] font-normal leading-tight">累計</div>
                          )}
                        </td>
                        {monthRows.map((row, monthIndex) => {
                          const cellBg = cellBackground(monthIndex % 2 === 0, metric.highlight);
                          const v = metric.render(row.columns[crIndex]);
                          return (
                            <td
                              key={row.month}
                              className={`px-2 ${cellPy} text-right ${cellBg} ${cellWeight} ${
                                metric.series === "target" ? "text-[var(--text-secondary)]" : ""
                              }`}
                              style={v.color ? { color: v.color } : undefined}
                            >
                              {v.text}
                              {metric.cumulative && <CumulativeNote value={metric.cumulative(row.columns[crIndex])} />}
                            </td>
                          );
                        })}
                        <td
                          className={`border-l-2 border-[var(--baseline)] px-2 ${cellPy} text-right ${metric.highlight ? "font-semibold" : "font-medium"} ${cellBackground(true, metric.highlight)} ${
                            metric.series === "target" ? "text-[var(--text-secondary)]" : ""
                          }`}
                          style={total.color ? { color: total.color } : undefined}
                        >
                          {total.text}
                          {metric.cumulative && <CumulativeNote value={metric.cumulative(totalCol)} />}
                        </td>
                      </tr>
                    );
                  })}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
