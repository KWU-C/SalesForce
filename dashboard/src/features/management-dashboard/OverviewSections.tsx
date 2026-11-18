import { FISCAL_MONTH_ORDER } from "@/config/fiscalPeriods";
import { formatDateTime, formatPercent } from "@/utils/format";
import { changeRate } from "./performanceView";
import type { CumulativeAmount, PerformanceColumn, SummaryBasis, TargetMonth } from "./overviewComparison";

// ---------------------------------------------------------------------------
// 表示形式(経理調整済み・帳簿上の進捗の2段で共通)

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

type Note = { tone: "serious" | "secondary"; text: string };

function Notes({ notes }: { notes: Note[] }) {
  if (notes.length === 0) return null;
  return (
    <div className="flex flex-col gap-0.5">
      {notes.map((n) => (
        <p key={n.text} className={`text-sm ${n.tone === "serious" ? "text-[var(--status-serious)]" : "text-[var(--text-secondary)]"}`}>
          {n.text}
        </p>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 経営サマリー(経理確認済み・仕掛品振替反映分の累計と帳簿上の進捗を1つの表にまとめる)

/** 経営サマリーの1段(累計・仕掛品振替反映分/帳簿上の進捗)の入力 */
export interface PerformanceSummaryPart {
  /** adjusted で対象の月が1か月も無ければnull */
  column: PerformanceColumn | null;
  failed: boolean;
  /** adjusted: 累計の最終月の決め方 */
  basis?: SummaryBasis;
  /** adjusted: 月末を経過しているが対象外のため累計に含めなかった月 */
  excludedMonths?: TargetMonth[];
}

function kindLabel(kind: "adjusted" | "progress", basis?: SummaryBasis): string {
  return kind === "progress" ? "帳簿上の進捗" : basis?.kind === "confirmed" ? "累計・経理確認済み" : "累計・仕掛品振替反映分";
}

/** 段ごとの注記(欠けた月・前年同期の欠け・仕掛品振替の未検出・対象外の月)。0円や他の値で代用しないことを明示する */
function partNotes(kind: "adjusted" | "progress", part: PerformanceSummaryPart): Note[] {
  const { column, failed, basis, excludedMonths = [] } = part;
  const notes: Note[] = [];
  const prefix = column ? `${periodLabel(column)} ${kindLabel(kind, basis)}：` : "";
  if (failed) notes.push({ tone: "serious", text: `※ ${prefix}月次業績の読み込みに失敗しました。` });
  const confirmed = basis?.kind === "confirmed";
  if (excludedMonths.length > 0) {
    notes.push({
      tone: "serious",
      text: `※ ${excludedMonths.map((m) => `${m.term}期${m.month}月`).join("・")}は月末を経過していますが、${
        confirmed ? "経理確認の対象月に含まれていない" : "freeeで仕掛品振替が未検出の"
      }ため、累計に含めていません（帳簿上の進捗には含みます）。`,
    });
  }
  if (column === null) return notes;
  const t = column.through;
  if (column.missingMonths.length > 0) {
    notes.push({
      tone: "serious",
      text: `※ ${prefix}${monthList(column.missingMonths)}は保存された値が無いため、累計を表示していません（0円や他の値で代用しません）。`,
    });
  }
  if (column.previousMissingMonths.length > 0) {
    notes.push({
      tone: "secondary",
      text: `※ ${prefix}前年同期（${t.term - 1}期）の${monthList(column.previousMissingMonths)}が未取得のため、前年同期・増減は表示していません。`,
    });
  }
  if (column.noWipTransferMonths.length > 0) {
    notes.push(
      kind === "adjusted" && confirmed
        ? {
            tone: "secondary",
            text: `※ ${prefix}${monthList(column.noWipTransferMonths)}はfreeeで仕掛品振替が未検出ですが、経理確認の指定にもとづき累計に含めています。`,
          }
        : {
            tone: "serious",
            text: `※ ${prefix}${monthList(column.noWipTransferMonths)}はfreeeで仕掛品振替が未検出です。振替が入ると経常利益・営業利益が大きく変わることがあります。`,
          }
    );
  }
  return notes;
}

/** 段ごとの範囲・取得日時・集計の説明(表の上に1行ずつ) */
function partCaption(kind: "adjusted" | "progress", part: PerformanceSummaryPart): string {
  const { column, basis } = part;
  if (column === null) {
    return "累計：経理確認の対象月が未指定で、仕掛品振替が確認できた月（月末後に取得したもの）も無いため、累計を表示していません。";
  }
  const t = column.through;
  const detail =
    kind === "adjusted"
      ? basis?.kind === "confirmed"
        ? `業績・採算タブの月次の合計。期首から、経理確認で指定された${t.month}月までです（${formatDateTime(basis.updatedAt)} 指定）`
        : "業績・採算タブの月次の合計。期首から、月末後に取得しfreeeで仕掛品振替が確認できた月までです（暫定。経理確認の対象月を指定すると、その月までに切り替わります）"
      : `${t.month}月分はfreeeに登録済みの${t.month}月日付の取引を含む途中の値です（当日までの確定実績・予測ではありません）`;
  return `${periodLabel(column)} ${kindLabel(kind, basis)}：${periodRange(column)}の累計（${column.months.length}ヶ月）／${fetchedLabel(column.fetchedFrom, column.fetchedTo)}／${detail}`;
}

/** 経営サマリーの表のセル(資金サマリーと同じ中央揃え・円) */
const thCell = "px-2 py-1.5 text-center font-medium whitespace-nowrap text-[var(--text-muted)]";
const tdCell = "px-2 py-1.5 text-center whitespace-nowrap tabular-nums text-[var(--text-primary)]";
const tdLabel = "border-r border-[var(--gridline)] px-2 py-1.5 text-left whitespace-nowrap text-[var(--text-secondary)]";

function signedNumber(value: number): string {
  return value < 0 ? `▲${Math.abs(value).toLocaleString("ja-JP")}` : value.toLocaleString("ja-JP");
}

function amountCell(value: number | null, key: string, cls = "") {
  return (
    <td key={key} className={`${tdCell} ${cls} ${value !== null && value < 0 ? "text-[var(--status-serious)]" : ""}`}>
      {value === null ? <span className="text-[var(--text-muted)]">未取得</span> : signedNumber(value)}
    </td>
  );
}

function changeCell(amount: CumulativeAmount, withRate: boolean, key: string) {
  if (amount.change === null) {
    return (
      <td key={key} className={tdCell}>
        <span className="text-[var(--text-muted)]">比較不可</span>
      </td>
    );
  }
  const rate = withRate && amount.previous !== null && amount.current !== null ? changeRate(amount.current, amount.previous) : null;
  return (
    <td key={key} className={tdCell}>
      {`${amount.change < 0 ? "▲" : "＋"}${Math.abs(amount.change).toLocaleString("ja-JP")}`}
      {rate !== null && <span className="text-[var(--text-secondary)]">{`（${rate < 0 ? "▲" : "＋"}${formatPercent(Math.abs(rate))}）`}</span>}
    </td>
  );
}

/** 列: 売上高累計(増減に率) / 経常利益累計 / 営業利益累計 */
const SUMMARY_COLUMNS: { key: "revenue" | "ordinaryProfit" | "operatingProfit"; label: string; withRate: boolean }[] = [
  { key: "revenue", label: "売上高累計", withRate: true },
  { key: "ordinaryProfit", label: "経常利益累計", withRate: false },
  { key: "operatingProfit", label: "営業利益累計", withRate: false },
];

function PartRows({ kind, part }: { kind: "adjusted" | "progress"; part: PerformanceSummaryPart }) {
  const { column, basis } = part;
  const head = (rows: number) => (
    <th
      scope="rowgroup"
      rowSpan={rows}
      className="border-r border-[var(--gridline)] px-3 py-1.5 text-center align-middle whitespace-nowrap text-[var(--text-primary)]"
    >
      <span className="block font-semibold">{column ? periodLabel(column) : "累計"}</span>
      <span className="block text-xs font-normal text-[var(--text-secondary)]">{kindLabel(kind, basis)}</span>
    </th>
  );
  if (column === null) {
    return (
      <tbody className="border-b border-[var(--border-hairline)] last:border-b-0">
        <tr>
          {head(1)}
          <td colSpan={4} className={`${tdCell} whitespace-normal text-[var(--status-serious)]`}>
            累計を表示していません（経理確認の対象月が未指定で、仕掛品振替が確認できた月も無いため）
          </td>
        </tr>
      </tbody>
    );
  }
  const a = column.amounts;
  return (
    <tbody className="border-b border-[var(--border-hairline)] last:border-b-0">
      <tr className="border-b border-[var(--gridline)]">
        {head(3)}
        <td className={tdLabel}>当期累計</td>
        {SUMMARY_COLUMNS.map((c, i) =>
          amountCell(a[c.key].current, c.key, i === 0 ? "bg-[var(--surface-highlight)] text-base font-bold" : "font-semibold")
        )}
      </tr>
      <tr className="border-b border-dashed border-[var(--baseline)]">
        <td className={tdLabel}>前年同期</td>
        {SUMMARY_COLUMNS.map((c) => amountCell(a[c.key].previous, c.key))}
      </tr>
      <tr>
        <td className={tdLabel}>増減</td>
        {SUMMARY_COLUMNS.map((c) => changeCell(a[c.key], c.withRate, c.key))}
      </tr>
    </tbody>
  );
}

/**
 * 概要「経営サマリー」(2026-11-18、ユーザー指定: 資金サマリーと同じく1つの表にまとめる)。
 * 行: 累計・仕掛品振替反映分(または経理確認済み)と帳簿上の進捗の2段 × 当期累計/前年同期/増減。
 * 列: 売上高累計(増減に率) / 経常利益累計 / 営業利益累計。単位は円。
 * - adjusted: 期首から、経理確認で指定された月(指定が無い間は暫定で仕掛品振替が確認できた月)までの累計。
 *   業績・採算タブの月次の合計で、経理報告の「売上高累計・経常利益累計」と同じ範囲。対象外の月は含めず明示する
 * - progress: 当月を含む期首からの累計(freeeに登録済みの当月日付の取引を含む途中の値)
 * 目標との差は、会計の売上高と同じ定義の目標がシステムに無いため出さない(Salesforceの受注・完了目標で代用しない)。
 */
export function PerformanceSummaryTable({
  adjusted,
  progress,
  action,
}: {
  adjusted: PerformanceSummaryPart;
  progress: PerformanceSummaryPart;
  /** 経理確認の対象月の指定フォーム */
  action?: React.ReactNode;
}) {
  const notes = [...partNotes("adjusted", adjusted), ...partNotes("progress", progress)];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5 text-xs text-[var(--text-secondary)]">
        <p>{partCaption("adjusted", adjusted)}</p>
        <p>{partCaption("progress", progress)}</p>
      </div>
      <div className="overflow-x-auto rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)]">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border-hairline)]">
              <th className={thCell} colSpan={2}>
                <span className="sr-only">期間・項目</span>
              </th>
              {SUMMARY_COLUMNS.map((c) => (
                <th key={c.key} className={thCell}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <PartRows kind="adjusted" part={adjusted} />
          <PartRows kind="progress" part={progress} />
        </table>
      </div>
      <p className="text-sm text-[var(--text-secondary)]">単位：円。▲はマイナス。前年同期は前期の同じ月までの累計です。</p>
      <Notes notes={notes} />
      {action}
    </div>
  );
}
