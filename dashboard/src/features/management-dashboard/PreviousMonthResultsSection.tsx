import { fiscalYearToDateMonthsLabel } from "@/config/fiscalPeriods";
import { formatDateTime, formatPercent, formatYen } from "@/utils/format";
import { SectionBanner } from "./SectionBanner";
import { changeRate } from "./performanceView";
import type { CumulativeAmount, PreviousMonthCash, PreviousMonthPerformance, TargetMonth } from "./previousMonthResults";

function signedYen(value: number): string {
  return value < 0 ? `▲${formatYen(Math.abs(value))}` : formatYen(value);
}

function changeYen(value: number): string {
  return `${value < 0 ? "▲" : "＋"}${formatYen(Math.abs(value))}`;
}

function monthList(months: number[]): string {
  return months.map((m) => `${m}月`).join("・");
}

function fetchedLabel(from: Date | null, to: Date | null): string {
  if (from === null || to === null) return "freee取得: なし";
  return from.getTime() === to.getTime()
    ? `freee取得: ${formatDateTime(to)}`
    : `freee取得: ${formatDateTime(from)}〜${formatDateTime(to)}（月により異なる）`;
}

/** 大きい数字+補足行のカード。値が無いときは status の文言(未取得・未設定)を出す */
function ResultCard({
  title,
  value,
  emptyLabel,
  lines,
}: {
  title: string;
  value: number | null;
  emptyLabel: string;
  lines: React.ReactNode[];
}) {
  return (
    <div className="rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)] p-4">
      <p className="text-sm text-[var(--text-secondary)]">{title}</p>
      <p
        className={`mt-1 text-2xl font-semibold tabular-nums ${
          value === null
            ? "text-[var(--text-muted)]"
            : value < 0
              ? "text-[var(--status-serious)]"
              : "text-[var(--text-primary)]"
        }`}
      >
        {value === null ? emptyLabel : signedYen(value)}
      </p>
      <div className="mt-2 flex flex-col gap-0.5 border-t border-[var(--gridline)] pt-2">
        {lines.map((line, i) => (
          <p key={i} className="text-xs text-[var(--text-muted)]">
            {line}
          </p>
        ))}
      </div>
    </div>
  );
}

/** 前年同期と増減額の補足行。増減は額を基本にし、率は売上高だけ添える(前年が赤字の利益に率は使わない) */
function comparisonLines(amount: CumulativeAmount, withRate: boolean): string[] {
  if (amount.previous === null) return ["前年同期: 未取得"];
  const rate = withRate ? changeRate(amount.current, amount.previous) : null;
  return [
    `前年同期 ${signedYen(amount.previous)}`,
    amount.change === null
      ? "増減: 比較不可"
      : `増減 ${changeYen(amount.change)}${rate === null ? "" : `（${rate < 0 ? "▲" : "＋"}${formatPercent(Math.abs(rate))}）`}`,
  ];
}

function Notice({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-[var(--status-serious)]">{children}</p>;
}

function monthEndLabel(target: TargetMonth): string {
  return `${target.calendarYear}年${target.month}月末`;
}

function PerformanceGroup({ performance, failed }: { performance: PreviousMonthPerformance; failed: boolean }) {
  const { target } = performance;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <SectionBanner>
        業績｜{target.term}期 {fiscalYearToDateMonthsLabel(target.month)}累計（{monthEndLabel(target)}まで）
      </SectionBanner>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <ResultCard
          title="売上高累計"
          value={performance.revenue.current}
          emptyLabel="未取得"
          lines={comparisonLines(performance.revenue, true)}
        />
        <ResultCard
          title="経常利益累計"
          value={performance.ordinaryProfit.current}
          emptyLabel="未取得"
          lines={comparisonLines(performance.ordinaryProfit, false)}
        />
      </div>
      <div className="flex flex-col gap-0.5">
        {failed && <Notice>※ 月次業績の読み込みに失敗しました。</Notice>}
        {performance.missingMonths.length > 0 && (
          <Notice>
            ※ {monthList(performance.missingMonths)}は月末後にfreeeから取得した値が無いため、累計を表示していません（月末前の取得分や他の月で代用しません）。
          </Notice>
        )}
        {performance.noWipTransferMonths.length > 0 && (
          <Notice>
            ※ {monthList(performance.noWipTransferMonths)}はfreeeで仕掛品振替が未検出です。月次の仕掛品振替が入ると経常利益が大きく変わることがあります。
          </Notice>
        )}
        <p className="text-xs text-[var(--text-muted)]">
          ※ 期首（9月）から{monthEndLabel(target)}までの単月値の合計。前年同期は前期の同じ月まで。経常利益は営業外損益を含み、営業利益とは別の指標です。
        </p>
        <p className="text-xs text-[var(--text-muted)]">{fetchedLabel(performance.fetchedFrom, performance.fetchedTo)}</p>
      </div>
    </div>
  );
}

function CashGroup({ cash }: { cash: PreviousMonthCash }) {
  const fetched = cash.status === "fetched" ? cash : null;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <SectionBanner>資金｜{monthEndLabel(cash.target)}実績</SectionBanner>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <ResultCard
          title="当座・普通預金合計"
          value={fetched?.checkingSavings ?? null}
          emptyLabel="未取得"
          lines={["定期預金・小口現金・保険積立金は含みません"]}
        />
        <ResultCard
          title="預金総合計（担保控除後）"
          value={fetched?.depositTotalAfterCollateral ?? null}
          emptyLabel={fetched ? "未設定" : "未取得"}
          lines={[
            "当座・普通＋定期 − 担保控除額（経理の管理値）",
            ...(fetched && fetched.depositTotalAfterCollateral === null
              ? ["担保控除額の管理設定が無いため表示していません"]
              : []),
            ...(fetched ? [`参考: 預金合計（担保控除前） ${formatYen(fetched.depositTotalBeforeCollateral)}`] : []),
          ]}
        />
      </div>
      <div className="flex flex-col gap-0.5">
        {!fetched && (
          <Notice>※ {monthEndLabel(cash.target)}より後にfreeeから取得した種類別の残高がありません（月末前の取得分は使いません）。</Notice>
        )}
        {fetched && fetched.kindsDifference !== 0 && (
          <Notice>
            ※ freeeの種類別残高（当座・普通＋定期＋現金）が月末現預金と合いません（差 {formatYen(fetched.kindsDifference)}）。分類できない預金科目がある可能性があります。
          </Notice>
        )}
        <p className="text-xs text-[var(--text-muted)]">
          ※ 消費税準備・賞与準備は差し引いていません（「資金余力」とは別の指標）。小口現金を含む「現預金」とも範囲が異なります。
        </p>
        <p className="text-xs text-[var(--text-muted)]">{fetched ? `freee取得: ${formatDateTime(fetched.fetchedAt)}` : "freee取得: なし"}</p>
      </div>
    </div>
  );
}

/**
 * 概要「前月末までの実績」(2026-11-13)。業績(売上高累計・経常利益累計)と資金(当座・普通預金合計・
 * 預金総合計(担保控除後))の2グループ。PCは2グループを横に並べ、各グループは2カード。狭い幅では縦に並ぶ。
 * 業績と資金は取得日時が別なので、それぞれの取得日時を出す。
 */
export function PreviousMonthResults({
  performance,
  performanceFailed,
  cash,
}: {
  performance: PreviousMonthPerformance;
  performanceFailed: boolean;
  cash: PreviousMonthCash;
}) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:gap-4">
      <PerformanceGroup performance={performance} failed={performanceFailed} />
      <CashGroup cash={cash} />
    </div>
  );
}

/** 概要の2本立て(前月末までの実績/現在の状況)の見出し */
export function OverviewPartHeading({ title, note }: { title: string; note: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b-2 border-[var(--band-bg)] pb-1">
      <h2 className="text-lg font-bold text-[var(--text-primary)]">{title}</h2>
      <p className="text-xs text-[var(--text-muted)]">{note}</p>
    </div>
  );
}
