import { fiscalYearToDateMonthsLabel } from "@/config/fiscalPeriods";
import { formatDateTime, formatPercent, formatYen } from "@/utils/format";
import { SectionBanner } from "./SectionBanner";
import { changeRate, ratioToRevenue } from "./performanceView";
import type { CashColumn, CumulativeAmount, CumulativeField, PerformanceColumn, TargetMonth } from "./overviewComparison";

// ---------------------------------------------------------------------------
// 表示形式(実績・速報、前月末・現在の両列で共通)

function signedYen(value: number): string {
  return value < 0 ? `▲${formatYen(Math.abs(value))}` : formatYen(value);
}

function changeYen(value: number): string {
  return `${value < 0 ? "▲" : "＋"}${formatYen(Math.abs(value))}`;
}

function signedRate(rate: number): string {
  return rate < 0 ? `▲${formatPercent(Math.abs(rate))}` : formatPercent(rate);
}

function pointDiff(current: number, previous: number): string {
  const diff = current - previous;
  return `${diff < 0 ? "▲" : "＋"}${Math.abs(diff).toFixed(1)}pt`;
}

function monthList(months: number[]): string {
  return months.map((m) => `${m}月`).join("・");
}

function monthEndLabel(target: TargetMonth): string {
  return `${target.calendarYear}年${target.month}月末`;
}

function fetchedRange(from: Date | null, to: Date | null): string {
  if (from === null || to === null) return "freee取得: なし";
  // 表示は分単位なので、同じ分に取得した月は1つの日時として出す(同じ更新操作で月ごとに数秒ずれる)
  const fromLabel = formatDateTime(from);
  const toLabel = formatDateTime(to);
  return fromLabel === toLabel ? `freee取得: ${toLabel}` : `freee取得: ${fromLabel}〜${toLabel}（月により異なる）`;
}

/**
 * PCは2列(左=実績・前月末、右=速報・現在)で、同じ指標が同じ行に並ぶ。狭い幅は1列にし、左列を全部並べてから
 * 右列を並べる(order で並べ替える)。行数は1列あたり最大12まで。
 */
const LEFT_ORDER = ["order-1", "order-2", "order-3", "order-4", "order-5", "order-6"];
const RIGHT_ORDER = ["order-7", "order-8", "order-9", "order-10", "order-11", "order-12"];

function ComparisonGrid({ left, right }: { left: React.ReactNode[]; right: React.ReactNode[] }) {
  const rows = Math.max(left.length, right.length);
  const cells: React.ReactNode[] = [];
  for (let i = 0; i < rows; i++) {
    cells.push(
      <div key={`l${i}`} className={`${LEFT_ORDER[i]} flex min-w-0 flex-col lg:order-none`}>
        {left[i]}
      </div>,
      <div key={`r${i}`} className={`${RIGHT_ORDER[i]} flex min-w-0 flex-col lg:order-none ${i === 0 ? "mt-4 lg:mt-0" : ""}`}>
        {right[i]}
      </div>
    );
  }
  return <div className="grid grid-cols-1 gap-x-4 gap-y-3 lg:grid-cols-2">{cells}</div>;
}

function ColumnHeader({ title, lines, emphasis }: { title: string; lines: string[]; emphasis?: string }) {
  return (
    <div className="flex h-full flex-col gap-0.5 rounded-md bg-[var(--surface-sunken)] px-3 py-2">
      <p className="text-sm font-bold text-[var(--text-primary)]">{title}</p>
      {lines.map((line) => (
        <p key={line} className="text-xs text-[var(--text-secondary)]">
          {line}
        </p>
      ))}
      {emphasis && <p className="text-xs text-[var(--text-muted)]">{emphasis}</p>}
    </div>
  );
}

function MetricCard({
  label,
  value,
  emptyLabel = "未取得",
  lines,
}: {
  label: string;
  value: number | null;
  emptyLabel?: string;
  lines: string[];
}) {
  return (
    <div className="flex h-full flex-col rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)] p-4">
      <p className="text-sm text-[var(--text-secondary)]">{label}</p>
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
      {lines.length > 0 && (
        <div className="mt-2 flex flex-col gap-0.5 border-t border-[var(--gridline)] pt-2">
          {lines.map((line) => (
            <p key={line} className="text-xs text-[var(--text-muted)]">
              {line}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

/** 未取得・未設定・未検出などの状態。説明の開閉欄には入れず、常に見せる */
function StatusNotes({ notes }: { notes: { tone: "serious" | "warning" | "muted"; text: string }[] }) {
  if (notes.length === 0) return <div />;
  const color = { serious: "text-[var(--status-serious)]", warning: "text-[var(--text-secondary)]", muted: "text-[var(--text-muted)]" };
  return (
    <div className="flex flex-col gap-0.5">
      {notes.map((n) => (
        <p key={n.text} className={`text-xs ${color[n.tone]}`}>
          {n.text}
        </p>
      ))}
    </div>
  );
}

function Definitions({ summary, items }: { summary: string; items: string[] }) {
  return (
    <details className="group text-xs text-[var(--text-muted)]">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded focus-visible:ring-2 focus-visible:ring-[var(--series-1)] focus-visible:outline-none [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="inline-block transition-transform group-open:rotate-90">
          ▸
        </span>
        {summary}
      </summary>
      <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-6">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </details>
  );
}

// ---------------------------------------------------------------------------
// 経営サマリー(業績)

function previousLine(amount: CumulativeAmount, withRate: boolean): string {
  if (amount.previous === null) return "前年同期: 未取得";
  const rate = withRate ? changeRate(amount.current, amount.previous) : null;
  const change =
    amount.change === null
      ? "増減 比較不可"
      : `増減 ${changeYen(amount.change)}${rate === null ? "" : `（${rate < 0 ? "▲" : "＋"}${formatPercent(Math.abs(rate))}）`}`;
  return `前年同期 ${signedYen(amount.previous)}／${change}`;
}

function marginLine(column: PerformanceColumn, field: CumulativeField, label: string): string {
  const { current, previous } = column.amounts[field];
  const rate = ratioToRevenue(current, column.amounts.revenue.current);
  const previousRate = ratioToRevenue(previous, column.amounts.revenue.previous);
  const head = `${label} ${rate === null ? "—" : signedRate(rate)}`;
  if (previousRate === null) return `${head}（前年同期: 未取得）`;
  return `${head}（前年同期 ${signedRate(previousRate)}${rate === null ? "" : `、${pointDiff(rate, previousRate)}`}）`;
}

function performanceCells(column: PerformanceColumn): React.ReactNode[] {
  const { amounts } = column;
  return [
    <MetricCard key="revenue" label="① 売上高累計" value={amounts.revenue.current} lines={[previousLine(amounts.revenue, true)]} />,
    <MetricCard
      key="gross"
      label="② 売上総利益累計"
      value={amounts.grossProfit.current}
      lines={[marginLine(column, "grossProfit", "粗利益率"), previousLine(amounts.grossProfit, false)]}
    />,
    <MetricCard
      key="operating"
      label="③ 営業利益累計"
      value={amounts.operatingProfit.current}
      lines={[marginLine(column, "operatingProfit", "営業利益率"), previousLine(amounts.operatingProfit, false)]}
    />,
    <MetricCard
      key="ordinary"
      label="④ 経常利益累計"
      value={amounts.ordinaryProfit.current}
      lines={[previousLine(amounts.ordinaryProfit, false)]}
    />,
  ];
}

function performanceNotes(column: PerformanceColumn, missingReason: string, failed: boolean) {
  const notes: { tone: "serious" | "warning" | "muted"; text: string }[] = [];
  if (failed) notes.push({ tone: "serious", text: "※ 月次業績の読み込みに失敗しました。" });
  if (column.missingMonths.length > 0) {
    notes.push({ tone: "serious", text: `※ 当期の未取得: ${monthList(column.missingMonths)}（${missingReason}）。累計は表示していません。` });
  }
  if (column.previousMissingMonths.length > 0) {
    notes.push({
      tone: "warning",
      text: `※ 前年同期の未取得: ${column.through.term - 1}期の${monthList(column.previousMissingMonths)}（保存なし）。前年同期・増減は表示していません。`,
    });
  }
  if (column.noWipTransferMonths.length > 0) {
    notes.push({
      tone: "serious",
      text: `※ 仕掛品振替が未検出: ${monthList(column.noWipTransferMonths)}。仕掛品振替が入ると売上総利益以下が大きく変わることがあります（月次決算の確定判定ではありません）。`,
    });
  }
  return notes;
}

/**
 * 経営サマリー(2026-11-13)。左=前月末までの実績、右=当月途中を含む速報。同じ4指標を同じ順で並べる。
 * 両列は対象月数が違うので、列どうしの差は出さない(当月単月の実績や改善額ではない)。
 */
export function PerformanceComparison({
  actual,
  flash,
  failed,
}: {
  actual: PerformanceColumn;
  flash: PerformanceColumn;
  failed: boolean;
}) {
  const a = actual.through;
  const f = flash.through;
  return (
    <div className="flex flex-col gap-2">
      <SectionBanner>経営サマリー（業績）</SectionBanner>
      <ComparisonGrid
        left={[
          <ColumnHeader
            key="h"
            title="実績｜前月末まで"
            lines={[`${a.term}期 ${fiscalYearToDateMonthsLabel(a.month)}累計／${monthEndLabel(a)}まで`, fetchedRange(actual.fetchedFrom, actual.fetchedTo)]}
            emphasis="月末後に取得したfreee帳簿の数値。月次決算の確定は判定していません"
          />,
          ...performanceCells(actual),
          <StatusNotes key="n" notes={performanceNotes(actual, "月末後のfreee取得なし。月末前の取得分は使いません", failed)} />,
        ]}
        right={[
          <ColumnHeader
            key="h"
            title="速報｜当月途中"
            lines={[`${f.term}期 ${fiscalYearToDateMonthsLabel(f.month)}累計／当月途中・freee取得時点`, fetchedRange(flash.fetchedFrom, flash.fetchedTo)]}
            emphasis="freee帳簿の当月途中の数値で、将来予測ではありません"
          />,
          ...performanceCells(flash),
          <StatusNotes key="n" notes={performanceNotes(flash, "保存なし", failed)} />,
        ]}
      />
      <Definitions
        summary="算出範囲と定義"
        items={[
          "freeeの試算表（発生主義の損益）による、期首（9月）から各列の最終月までの単月値の合計。1か月でも欠けていれば累計は出しません（0円とみなしません）。",
          "前年同期は前期の同じ月までの累計。増減は金額の差、売上高のみ増減率も併記。利益率の差はポイント差。",
          "経常利益は営業外損益を含み、営業利益とは別の指標です。営業外収益（一時的な収益を含む）は営業利益に含みません。",
          "実績と速報は対象の月数が違うため、列どうしの差は当月の単月実績や改善額ではありません。月別の値は「業績・採算」タブの月次表で確認できます。",
          "後日の仕訳でfreeeの過去月の値が変わることがあります。表示は取得日時時点の値です。",
        ]}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 資金サマリー

function collateralLine(column: CashColumn): string {
  const c = column.collateral;
  if (c.amount === null) return "担保控除額: 未設定（経理の管理設定なし）";
  const basis = c.asOf ? `${c.asOf}時点${c.source ? `、${c.source}` : ""}` : "";
  return `担保控除額 ${formatYen(c.amount)}${basis ? `（${basis}）` : ""}`;
}

function cashCells(column: CashColumn, cashLabel: string): React.ReactNode[] {
  const fetched = column.status === "fetched" ? column : null;
  return [
    <MetricCard
      key="checking"
      label="当座・普通預金合計"
      value={fetched?.checkingSavings ?? null}
      lines={["定期預金・小口現金・保険積立金は含みません"]}
    />,
    <MetricCard
      key="deposit"
      label="預金総合計（担保控除後）"
      value={fetched?.depositTotalAfterCollateral ?? null}
      emptyLabel={fetched ? "未設定" : "未取得"}
      lines={[
        fetched ? `参考: 預金合計（担保控除前） ${formatYen(fetched.depositTotalBeforeCollateral)}` : "参考: 預金合計（担保控除前） 未取得",
        collateralLine(column),
      ]}
    />,
    <MetricCard key="cash" label={cashLabel} value={fetched?.cashClosing ?? null} lines={["小口現金を含む（預金合計とは範囲が違います）"]} />,
  ];
}

function cashNotes(column: CashColumn, notFetchedReason: string) {
  const notes: { tone: "serious" | "warning" | "muted"; text: string }[] = [];
  if (column.status === "notFetched") notes.push({ tone: "serious", text: `※ 未取得: ${notFetchedReason}` });
  if (column.status === "fetched" && column.kindsDifference !== 0) {
    notes.push({
      tone: "serious",
      text: `※ 種類別の残高（当座・普通＋定期＋現金）が現預金残高と合いません（差 ${formatYen(column.kindsDifference)}）。分類できない預金科目がある可能性があります。`,
    });
  }
  return notes;
}

/**
 * 資金サマリー(2026-11-13)。左=前月末の残高(月末後に取得した帳簿の月末残高)、右=現在(当月のfreee取得時点の
 * 帳簿残高。月末見通しではない)。担保控除額は各時点に有効な経理の管理設定を使う。
 */
export function CashComparison({
  target,
  previous,
  current,
  currentMonthLabel,
}: {
  target: TargetMonth;
  previous: CashColumn;
  current: CashColumn;
  /** 例: 2026年11月 */
  currentMonthLabel: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <SectionBanner>資金サマリー</SectionBanner>
      <ComparisonGrid
        left={[
          <ColumnHeader
            key="h"
            title={`前月末実績｜${monthEndLabel(target)}`}
            lines={[previous.status === "fetched" ? `freee取得: ${formatDateTime(previous.fetchedAt)}` : "freee取得: なし"]}
            emphasis="月末後に取得したfreee帳簿の月末残高"
          />,
          ...cashCells(previous, "前月末現預金"),
          <StatusNotes key="n" notes={cashNotes(previous, `${monthEndLabel(target)}より後にfreeeから取得した種類別の残高がありません（月末前の取得分は使いません）。`)} />,
        ]}
        right={[
          <ColumnHeader
            key="h"
            title={`現在｜${currentMonthLabel}・freee取得時点`}
            lines={[current.status === "fetched" ? `freee取得: ${formatDateTime(current.fetchedAt)}` : "freee取得: なし"]}
            emphasis="取得時点の帳簿残高で、月末の見通しではありません"
          />,
          ...cashCells(current, "現預金残高（取得時点）"),
          <StatusNotes key="n" notes={cashNotes(current, "当月の種類別の残高がまだ保存されていません。")} />,
        ]}
      />
      <Definitions
        summary="算出範囲と定義"
        items={[
          "当座・普通預金合計 = 当座預金＋普通預金（freeeの科目の月末残高・取得時点の残高）。",
          "預金総合計（担保控除後） = 当座・普通預金＋定期預金 − 担保控除額。担保控除額は経理の管理値で、各時点に有効な設定を使います（当座貸越の枠・利用額や担保定期の残高では代用しません）。",
          "消費税準備・賞与準備は差し引いていません。「資金余力」（現預金総額 − 当座貸越利用額 − 消費税準備 − 賞与準備）とは別の指標です。",
          "現預金残高は小口現金を含みます。",
        ]}
      />
    </div>
  );
}
