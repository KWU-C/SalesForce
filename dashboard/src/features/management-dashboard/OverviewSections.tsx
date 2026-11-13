import { FISCAL_MONTH_ORDER } from "@/config/fiscalPeriods";
import { formatDateTime, formatPercent, formatYen } from "@/utils/format";
import { SectionBanner } from "./SectionBanner";
import { changeRate } from "./performanceView";
import type { CashPlan } from "./accountingReports";
import type { CumulativeAmount, PerformanceColumn, TargetMonth } from "./overviewComparison";

// ---------------------------------------------------------------------------
// 表示形式(実績・進捗の2段で共通)

function signedYen(value: number): string {
  return value < 0 ? `▲${formatYen(Math.abs(value))}` : formatYen(value);
}

function changeYen(value: number): string {
  return `${value < 0 ? "▲" : "＋"}${formatYen(Math.abs(value))}`;
}

function monthList(months: number[]): string {
  return months.map((m) => `${m}月`).join("・");
}

function lastDayOf(target: TargetMonth): number {
  return new Date(Date.UTC(target.calendarYear, target.month, 0)).getUTCDate();
}

function fetchedLabel(from: Date | null, to: Date | null): string {
  if (from === null || to === null) return "freee取得: なし";
  // 表示は分単位なので、同じ分に取得した月は1つの日時として出す(同じ更新操作で月ごとに数秒ずれる)
  const fromLabel = formatDateTime(from);
  const toLabel = formatDateTime(to);
  return fromLabel === toLabel ? `freee取得: ${toLabel}` : `freee取得: ${fromLabel}〜${toLabel}（月により異なる）`;
}

/** 帯の見出しに出す期間(例: 9月–10月)。期首月だけなら「9月」 */
export function periodLabel(column: PerformanceColumn): string {
  const first = FISCAL_MONTH_ORDER[0];
  return column.through.month === first ? `${first}月` : `${first}月–${column.through.month}月`;
}

/** 期首月1日〜最終月末日(例: 50期・2025年9月1日〜2026年8月31日) */
function periodRange(column: PerformanceColumn): string {
  const t = column.through;
  const startYear = t.month >= FISCAL_MONTH_ORDER[0] ? t.calendarYear : t.calendarYear - 1;
  return `${t.term}期・${startYear}年${FISCAL_MONTH_ORDER[0]}月1日〜${t.calendarYear}年${t.month}月${lastDayOf(t)}日`;
}

function SummaryBox({ title, value, lines }: { title: string; value: number | null; lines: string[] }) {
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
        {value === null ? "未取得" : signedYen(value)}
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

function previousLines(amount: CumulativeAmount, withRate: boolean): string[] {
  if (amount.previous === null) return ["前年同期: 未取得", "増減: 比較不可"];
  const rate = withRate ? changeRate(amount.current, amount.previous) : null;
  return [
    `前年同期 ${signedYen(amount.previous)}`,
    amount.change === null
      ? "増減: 比較不可"
      : `増減 ${changeYen(amount.change)}${rate === null ? "" : `（${rate < 0 ? "▲" : "＋"}${formatPercent(Math.abs(rate))}）`}`,
  ];
}

type Note = { tone: "serious" | "secondary"; text: string };

function Notes({ notes }: { notes: Note[] }) {
  if (notes.length === 0) return null;
  return (
    <div className="flex flex-col gap-0.5">
      {notes.map((n) => (
        <p key={n.text} className={`text-xs ${n.tone === "serious" ? "text-[var(--status-serious)]" : "text-[var(--text-secondary)]"}`}>
          {n.text}
        </p>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 経営サマリー(実績/進捗の各段: 帯+売上高累積・経常利益累積の2ボックス)

/**
 * 経営サマリーの1段(2026-11-13、ユーザー指定の構成)。kind=actual は前月末までの実績(月末後に取得した月だけ)、
 * progress は当月を含む進捗(freeeに登録済みの当月日付の取引を含む途中の値)。2段で同じ構成・同じ順序にする。
 * 売上高累積: 前年同期・増減(率)。経常利益累積: 前年同期・増減・営業利益累積。
 * 目標との差は、会計の売上高と同じ定義の目標がシステムに無いため出さない(Salesforceの受注・完了目標で代用しない)。
 */
export function PerformanceSummaryBand({
  kind,
  column,
  failed,
}: {
  kind: "actual" | "progress";
  column: PerformanceColumn;
  failed: boolean;
}) {
  const { amounts } = column;
  const t = column.through;
  const notes: Note[] = [];
  if (failed) notes.push({ tone: "serious", text: "※ 月次業績の読み込みに失敗しました。" });
  if (column.missingMonths.length > 0) {
    notes.push({
      tone: "serious",
      text: `※ ${monthList(column.missingMonths)}は${
        kind === "actual" ? "月末後にfreeeから取得した値が無い" : "保存された値が無い"
      }ため、累積を表示していません（0円や月末前の値で代用しません）。`,
    });
  }
  if (column.previousMissingMonths.length > 0) {
    notes.push({
      tone: "secondary",
      text: `※ 前年同期（${t.term - 1}期）の${monthList(column.previousMissingMonths)}が未取得のため、前年同期・増減は表示していません。`,
    });
  }
  if (column.noWipTransferMonths.length > 0) {
    notes.push({
      tone: "serious",
      text: `※ ${monthList(column.noWipTransferMonths)}はfreeeで仕掛品振替が未検出です。振替が入ると経常利益・営業利益が大きく変わることがあります（月次決算の確定判定ではありません）。`,
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <SectionBanner>
        経営サマリー（{periodLabel(column)} {kind === "actual" ? "実績" : "進捗"}）
      </SectionBanner>
      <p className="text-xs text-[var(--text-secondary)]">
        {periodRange(column)}の累積／{fetchedLabel(column.fetchedFrom, column.fetchedTo)}
        <span className="text-[var(--text-muted)]">
          {kind === "actual"
            ? "／月末後に取得したfreee帳簿の数値。月次決算の確定は判定していません"
            : `／${t.month}月分はfreeeに登録済みの${t.month}月日付の取引を含む途中の値です（当日までの確定実績・予測ではありません）`}
        </span>
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SummaryBox title="売上高累積" value={amounts.revenue.current} lines={previousLines(amounts.revenue, true)} />
        <SummaryBox
          title="経常利益累積"
          value={amounts.ordinaryProfit.current}
          lines={[
            ...previousLines(amounts.ordinaryProfit, false),
            `営業利益累積 ${amounts.operatingProfit.current === null ? "未取得" : signedYen(amounts.operatingProfit.current)}`,
          ]}
        />
      </div>
      <Notes notes={notes} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 収支予定

function planAmount(value: number | null | undefined): string {
  return value === null || value === undefined ? "記載なし" : signedYen(value);
}

/**
 * 収支予定(2026-11-13)。当月末・翌月末について、登録済みの経理の資金繰り予定(cashPlanForecasts)の
 * 当座・普通預金合計と預金総合計(担保控除後)を出す。freeeが算出した予測ではなく、現在残高・前月末残高でも
 * 埋めない。登録が無い月は「未算出」。
 */
export function CashPlanOutlook({
  outlook,
  failed,
}: {
  outlook: { target: TargetMonth; plan: CashPlan | null }[];
  failed: boolean;
}) {
  const label = (t: TargetMonth) => `${t.calendarYear}年${t.month}月末`;
  const TH = "px-3 py-2 text-right font-medium whitespace-nowrap";
  const TD = "px-3 py-2 text-right tabular-nums whitespace-nowrap";
  return (
    <div className="flex flex-col gap-2">
      <SectionBanner>収支予定</SectionBanner>
      <p className="text-xs text-[var(--text-secondary)]">
        経理の資金繰り予定（登録済みの値）による月末の予定残高です。freeeが算出した予測ではありません。
      </p>
      {failed ? (
        <p className="text-sm text-[var(--status-serious)]">資金繰り予定の読み込みに失敗しました。</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)]">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--gridline)] bg-[var(--surface-sunken)] text-xs text-[var(--text-muted)]">
                <th className="px-3 py-2 text-left font-medium">予定</th>
                {outlook.map(({ target }) => (
                  <th key={target.key} className={TH}>
                    {label(target)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-[var(--gridline)]">
                <td className="px-3 py-2 whitespace-nowrap text-[var(--text-primary)]">当座・普通預金合計</td>
                {outlook.map(({ target, plan }) => (
                  <td key={target.key} className={`${TD} ${plan ? "font-semibold" : "text-[var(--text-muted)]"}`}>
                    {plan ? planAmount(plan.values.checkingSavingsTotal) : "未算出"}
                  </td>
                ))}
              </tr>
              <tr className="border-t border-[var(--gridline)]">
                <td className="px-3 py-2 whitespace-nowrap text-[var(--text-primary)]">
                  預金総合計（担保控除後）
                  <span className="block text-xs text-[var(--text-muted)]">当座・普通＋定期 − 担保控除額</span>
                </td>
                {outlook.map(({ target, plan }) => (
                  <td key={target.key} className={`${TD} ${plan ? "font-semibold" : "text-[var(--text-muted)]"}`}>
                    {plan ? planAmount(plan.values.depositTotalAfterCollateral) : "未算出"}
                  </td>
                ))}
              </tr>
              <tr className="border-t border-[var(--gridline)] text-xs text-[var(--text-secondary)]">
                <td className="px-3 py-2 whitespace-nowrap">うち担保控除額（予定に記載の額）</td>
                {outlook.map(({ target, plan }) => (
                  <td key={target.key} className={TD}>
                    {plan ? planAmount(plan.values.collateralDeduction) : "―"}
                  </td>
                ))}
              </tr>
              <tr className="border-t border-[var(--gridline)] text-xs text-[var(--text-muted)]">
                <td className="px-3 py-2 whitespace-nowrap">予定の基準日・出所</td>
                {outlook.map(({ target, plan }) => (
                  <td key={target.key} className="px-3 py-2 text-right whitespace-nowrap">
                    {plan
                      ? `${plan.values.sourceUpdatedOn ? `${plan.values.sourceUpdatedOn.replaceAll("-", "/")}時点` : "基準日なし"}・経理の資金繰り予定`
                      : "登録された予定なし"}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-[var(--text-muted)]">
        ※ 消費税準備・賞与準備は預金総合計から差し引いていません。予定と月末後のfreee実績の比較は「財務・資金繰り」タブの資金繰り見通しで確認できます。
      </p>
    </div>
  );
}
