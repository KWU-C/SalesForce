import { FISCAL_MONTH_ORDER } from "@/config/fiscalPeriods";
import { formatDateTime, formatPercent, formatYen } from "@/utils/format";
import { SectionBanner } from "./SectionBanner";
import { changeRate } from "./performanceView";
import type { CashPlan } from "./accountingReports";
import type { CumulativeAmount, PerformanceColumn, SummaryBasis, TargetMonth } from "./overviewComparison";

// ---------------------------------------------------------------------------
// 表示形式(経理調整済み・帳簿上の進捗の2段で共通)

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
// 経営サマリー(経理確認済み・仕掛品振替反映分/帳簿上の進捗の各段: 帯+売上高累計・経常利益累計の2ボックス)

/**
 * 経営サマリーの1段。2段で同じ構成・同じ順序にする。
 * - adjusted(2026-11-16): 期首から、経理確認で指定された月(指定が無い間は暫定で仕掛品振替が確認できた月)までの
 *   累計。業績・採算タブの月次の合計で、経理報告の「売上高累計・経常利益累計」と同じ範囲(50期9月で円単位の一致を
 *   確認)。月末を経過していても対象外の月は含めず、その月を明示する。見出しは確認できた事実(経理確認済み/
 *   仕掛品振替反映分)だけを書く
 * - progress: 当月を含む期首からの累計(freeeに登録済みの当月日付の取引を含む途中の値)
 * 売上高累計: 前年同期・増減(率)。経常利益累計: 前年同期・増減・営業利益累計。
 * 目標との差は、会計の売上高と同じ定義の目標がシステムに無いため出さない(Salesforceの受注・完了目標で代用しない)。
 */
export function PerformanceSummaryBand({
  kind,
  column,
  failed,
  excludedMonths = [],
  basis,
  action,
}: {
  kind: "adjusted" | "progress";
  /** adjusted: 累計の最終月の決め方 */
  basis?: SummaryBasis;
  /** adjusted: 経理確認の対象月の指定フォーム */
  action?: React.ReactNode;
  /** adjusted で対象の月が1か月も無ければnull */
  column: PerformanceColumn | null;
  failed: boolean;
  /** adjusted: 月末を経過しているが対象外のため累計に含めなかった月 */
  excludedMonths?: TargetMonth[];
}) {
  const notes: Note[] = [];
  if (failed) notes.push({ tone: "serious", text: "※ 月次業績の読み込みに失敗しました。" });
  const confirmed = basis?.kind === "confirmed";
  if (excludedMonths.length > 0) {
    notes.push({
      tone: "serious",
      text: `※ ${excludedMonths.map((m) => `${m.term}期${m.month}月`).join("・")}は月末を経過していますが、${
        confirmed ? "経理確認の対象月に含まれていない" : "freeeで仕掛品振替が未検出の"
      }ため、累計に含めていません（帳簿上の進捗には含みます）。`,
    });
  }
  if (column === null) {
    return (
      <div className="flex flex-col gap-2">
        <SectionBanner>経営サマリー（仕掛品振替反映分の累計）</SectionBanner>
        <p className="text-sm text-[var(--status-serious)]">
          経理確認の対象月が未指定で、仕掛品振替が確認できた月（月末後に取得したもの）も無いため、累計を表示していません。
        </p>
        <Notes notes={notes} />
        {action}
      </div>
    );
  }
  const { amounts } = column;
  const t = column.through;
  if (column.missingMonths.length > 0) {
    notes.push({
      tone: "serious",
      text: `※ ${monthList(column.missingMonths)}は保存された値が無いため、累計を表示していません（0円や他の値で代用しません）。`,
    });
  }
  if (column.previousMissingMonths.length > 0) {
    notes.push({
      tone: "secondary",
      text: `※ 前年同期（${t.term - 1}期）の${monthList(column.previousMissingMonths)}が未取得のため、前年同期・増減は表示していません。`,
    });
  }
  if (column.noWipTransferMonths.length > 0) {
    notes.push(
      kind === "adjusted" && confirmed
        ? {
            tone: "secondary",
            text: `※ ${monthList(column.noWipTransferMonths)}はfreeeで仕掛品振替が未検出ですが、経理確認の指定にもとづき累計に含めています。`,
          }
        : {
            tone: "serious",
            text: `※ ${monthList(column.noWipTransferMonths)}はfreeeで仕掛品振替が未検出です。振替が入ると経常利益・営業利益が大きく変わることがあります。`,
          }
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <SectionBanner>
        経営サマリー（{periodLabel(column)} {kind === "progress" ? "帳簿上の進捗" : confirmed ? "累計・経理確認済み" : "累計・仕掛品振替反映分"}）
      </SectionBanner>
      <p className="text-xs text-[var(--text-secondary)]">
        {periodRange(column)}の累計（{column.months.length}ヶ月）／{fetchedLabel(column.fetchedFrom, column.fetchedTo)}
        <span className="text-[var(--text-muted)]">
          {kind === "adjusted"
            ? basis?.kind === "confirmed"
              ? `／業績・採算タブの月次の合計。期首から、経理確認で指定された${t.month}月までです（${formatDateTime(basis.updatedAt)} 指定）`
              : "／業績・採算タブの月次の合計。期首から、月末後に取得しfreeeで仕掛品振替が確認できた月までです（暫定。経理確認の対象月を指定すると、その月までに切り替わります）"
            : `／${t.month}月分はfreeeに登録済みの${t.month}月日付の取引を含む途中の値です（当日までの確定実績・予測ではありません）`}
        </span>
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SummaryBox title="売上高累計" value={amounts.revenue.current} lines={previousLines(amounts.revenue, true)} />
        <SummaryBox
          title="経常利益累計"
          value={amounts.ordinaryProfit.current}
          lines={[
            ...previousLines(amounts.ordinaryProfit, false),
            `営業利益累計 ${amounts.operatingProfit.current === null ? "未取得" : signedYen(amounts.operatingProfit.current)}`,
          ]}
        />
      </div>
      <Notes notes={notes} />
      {action}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 収支予定

function PlanRow({ label, note, value, empty }: { label: string; note?: string; value: string; empty: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-sm text-[var(--text-secondary)]">
        {label}
        {note && <span className="block text-xs text-[var(--text-muted)]">{note}</span>}
      </span>
      <span
        className={`whitespace-nowrap text-xl font-semibold tabular-nums ${
          empty ? "text-[var(--text-muted)]" : "text-[var(--text-primary)]"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

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
  const label = (t: TargetMonth) => `${t.calendarYear}年${t.month}月末（予定）`;
  return (
    <div className="flex flex-col gap-2">
      <SectionBanner>収支予定</SectionBanner>
      <p className="text-xs text-[var(--text-secondary)]">
        経理の資金繰り予定（登録済みの値）による月末の予定残高です。freeeが算出した予測ではありません。
      </p>
      {failed ? (
        <p className="text-sm text-[var(--status-serious)]">資金繰り予定の読み込みに失敗しました。</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {outlook.map(({ target, plan }) => (
            <div key={target.key} className="rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)] p-4">
              <p className="mb-2 text-xs font-medium text-[var(--text-muted)]">{label(target)}</p>
              <PlanRow label="当座・普通預金合計" value={plan ? planAmount(plan.values.checkingSavingsTotal) : "未算出"} empty={!plan} />
              <PlanRow
                label="預金総合計（担保控除後）"
                note="当座・普通＋定期 − 担保控除額"
                value={plan ? planAmount(plan.values.depositTotalAfterCollateral) : "未算出"}
                empty={!plan}
              />
              <div className="mt-2 flex flex-col gap-0.5 border-t border-[var(--gridline)] pt-2 text-xs text-[var(--text-muted)]">
                {plan ? (
                  <>
                    <p>うち担保控除額（予定に記載の額） {planAmount(plan.values.collateralDeduction)}</p>
                    <p>
                      {plan.values.sourceUpdatedOn ? `${plan.values.sourceUpdatedOn.replaceAll("-", "/")}時点` : "基準日なし"}・経理の資金繰り予定
                    </p>
                  </>
                ) : (
                  <p>登録された予定なし（freeeの予定や現在残高からは算出していません）</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="text-xs text-[var(--text-muted)]">
        ※ 消費税準備・賞与準備は預金総合計から差し引いていません。予定と月末後のfreee実績の比較は「財務・資金繰り」タブの資金繰り見通しで確認できます。
      </p>
    </div>
  );
}
