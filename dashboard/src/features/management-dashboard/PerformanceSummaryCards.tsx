import { fiscalYearToDateMonthsLabel } from "@/config/fiscalPeriods";
import { formatPercent, formatYen } from "@/utils/format";
import { SectionBanner } from "./SectionBanner";
import { changeRate, cumulative, monthsWithoutWipTransfer, ratioToRevenue } from "./performanceView";
import type { PerformanceMonth } from "./performanceView";

function signedPercent(rate: number): string {
  return `${rate < 0 ? "▲" : "＋"}${formatPercent(Math.abs(rate))}`;
}

function signedYen(value: number): string {
  return value < 0 ? `▲${formatYen(Math.abs(value))}` : formatYen(value);
}

function signedRate(rate: number): string {
  return rate < 0 ? `▲${formatPercent(Math.abs(rate))}` : formatPercent(rate);
}

function pointDiff(current: number, previous: number): string {
  const diff = current - previous;
  return `${diff < 0 ? "▲" : "＋"}${Math.abs(diff).toFixed(1)}pt`;
}

function SummaryCard({ title, value, lines }: { title: string; value: number | null; lines: string[] }) {
  return (
    <div className="rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)] p-4">
      <p className="text-sm text-[var(--text-secondary)]">{title}</p>
      <p
        className={`mt-1 text-2xl font-semibold tabular-nums ${
          value !== null && value < 0 ? "text-[var(--status-serious)]" : "text-[var(--text-primary)]"
        }`}
      >
        {value === null ? "データ未設定" : signedYen(value)}
      </p>
      <div className="mt-2 flex flex-col gap-0.5 border-t border-[var(--gridline)] pt-2">
        {lines.map((line) => (
          <p key={line} className="text-xs text-[var(--text-muted)]">
            {line}
          </p>
        ))}
      </div>
    </div>
  );
}

/**
 * 経営サマリー(最上部)。期首(9月)〜当月の累計の売上高・売上総利益・営業利益と、前年同期(前期の同じ月まで)
 * との比較(ユーザー確定、2026-10-27)。値は月次業績・採算(freeeの試算表、発生主義の損益)の単月値の合計で、
 * 下の月次表の「当期累計」列と同じ。1か月でも未取得なら累計は「データ未設定」にする(欠けた月を0円にしない)。
 * 営業外収益(49期は保険解約の一時的な収益を含む)は営業利益に入らない。
 */
export function PerformanceSummaryCards({ months, currentMonth }: { months: PerformanceMonth[]; currentMonth: number }) {
  const revenue = cumulative(months, "revenue", "current");
  const previousRevenue = cumulative(months, "revenue", "previous");
  const grossProfit = cumulative(months, "grossProfit", "current");
  const previousGrossProfit = cumulative(months, "grossProfit", "previous");
  const operatingProfit = cumulative(months, "operatingProfit", "current");
  const previousOperatingProfit = cumulative(months, "operatingProfit", "previous");

  const grossRate = ratioToRevenue(grossProfit, revenue);
  const previousGrossRate = ratioToRevenue(previousGrossProfit, previousRevenue);
  const operatingRate = ratioToRevenue(operatingProfit, revenue);
  const previousOperatingRate = ratioToRevenue(previousOperatingProfit, previousRevenue);
  const revenueChange = changeRate(revenue, previousRevenue);
  const noWipMonths = monthsWithoutWipTransfer(months);

  const revenueLines = [
    previousRevenue === null
      ? "前年同期: データ未設定"
      : `前年同期 ${formatYen(previousRevenue)}${revenueChange === null ? "" : `（${signedPercent(revenueChange)}）`}`,
  ];
  const grossLines = [
    `粗利益率 ${grossRate === null ? "—" : signedRate(grossRate)}`,
    previousGrossRate === null
      ? "前年同期: データ未設定"
      : `前年同期 ${signedRate(previousGrossRate)}${grossRate === null ? "" : `（${pointDiff(grossRate, previousGrossRate)}）`}`,
  ];
  const operatingLines = [
    `営業利益率 ${operatingRate === null ? "—" : signedRate(operatingRate)}`,
    previousOperatingProfit === null
      ? "前年同期: データ未設定"
      : `前年同期 ${signedYen(previousOperatingProfit)}${
          previousOperatingRate === null ? "" : `（${signedRate(previousOperatingRate)}）`
        }`,
  ];

  return (
    <div className="flex flex-col gap-2">
      <SectionBanner>経営サマリー　当期累計（{fiscalYearToDateMonthsLabel(currentMonth)}）</SectionBanner>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SummaryCard title="累計売上高" value={revenue} lines={revenueLines} />
        <SummaryCard title="累計売上総利益" value={grossProfit} lines={grossLines} />
        <SummaryCard title="累計営業利益" value={operatingProfit} lines={operatingLines} />
      </div>
      <p className="text-xs text-[var(--text-muted)]">
        ※ freeeの試算表（発生主義の損益）による。前年同期は前期の同じ月までの累計。営業外収益（一時的な収益を含む）は営業利益に含まない。
      </p>
      {noWipMonths.length > 0 && (
        <p className="text-xs text-[var(--status-serious)]">
          ※ {noWipMonths.map((m) => `${m}月`).join("・")}はfreeeで仕掛品振替が未検出です。その月の売上総利益・営業利益は
          月次の仕掛品振替が入ると大きく変わることがあります。
        </p>
      )}
    </div>
  );
}
