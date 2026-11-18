import { formatPercent } from "@/utils/format";

/** 表の1行。金額は円(3桁区切り、マイナスは▲)、比率は%で表示する(2026-11-18、千円から円へ) */
export type PerformanceTableRow =
  | {
      kind: "amount";
      label: string;
      values: (number | null)[];
      cumulative: number | null;
      previousCumulative: number | null;
      /** 前年同期比の列に出す増減率(%)。省略時は空欄 */
      changeRate?: number | null;
      /** 前年同月の行など、補助の行(小さく薄い文字) */
      sub?: boolean;
      bold?: boolean;
    }
  | {
      kind: "rate";
      label: string;
      values: (number | null)[];
      cumulative: number | null;
      previousCumulative: number | null;
      sub?: boolean;
    }
  | { kind: "text"; label: string; values: string[]; note?: string };

/** 円・3桁区切り。マイナスは▲(概要と同じ表記) */
export function formatYenAmount(value: number): string {
  const yen = Math.round(value);
  return yen < 0 ? `▲${Math.abs(yen).toLocaleString("ja-JP")}` : yen.toLocaleString("ja-JP");
}

function formatRate(value: number): string {
  return value < 0 ? `▲${formatPercent(Math.abs(value))}` : formatPercent(value);
}

function formatPointDiff(diff: number): string {
  const sign = diff < 0 ? "▲" : "＋";
  return `${sign}${Math.abs(diff).toFixed(1)}pt`;
}

function formatChangeRate(rate: number): string {
  const sign = rate < 0 ? "▲" : "＋";
  return `${sign}${Math.abs(rate).toFixed(1)}%`;
}

/** 前年同期との増減。増減額を基本とし、前年が0円以下(赤字・0円)なら増減率は出さない(2026-11-18) */
function formatChange(current: number | null, previous: number | null): string {
  if (current === null || previous === null) return "—";
  const diff = current - previous;
  const amount = `${diff < 0 ? "▲" : "＋"}${Math.abs(Math.round(diff)).toLocaleString("ja-JP")}`;
  return previous > 0 ? `${amount}（${formatChangeRate((diff / previous) * 100)}）` : amount;
}

function Cell({
  children,
  sub = false,
  bold = false,
  negative = false,
  shaded = false,
}: {
  children: React.ReactNode;
  sub?: boolean;
  bold?: boolean;
  negative?: boolean;
  shaded?: boolean;
}) {
  const color = negative
    ? "text-[var(--status-serious)]"
    : sub
      ? "text-[var(--text-muted)]"
      : "text-[var(--text-primary)]";
  return (
    <td
      className={`whitespace-nowrap border-t border-[var(--gridline)] px-3 py-1.5 text-right tabular-nums ${
        sub ? "text-xs" : "text-sm"
      } ${bold ? "font-semibold" : ""} ${shaded ? "bg-[var(--surface-sunken)]" : ""} ${color}`}
    >
      {children}
    </td>
  );
}

function amountCell(value: number | null, opts: { sub?: boolean; bold?: boolean; shaded?: boolean } = {}) {
  return (
    <Cell {...opts} negative={value !== null && value < 0}>
      {value === null ? "—" : formatYenAmount(value)}
    </Cell>
  );
}

function rateCell(value: number | null, opts: { sub?: boolean; shaded?: boolean } = {}) {
  return (
    <Cell {...opts} negative={value !== null && value < 0}>
      {value === null ? "—" : formatRate(value)}
    </Cell>
  );
}

/** 累計の列の見出し(概要の経営サマリーと対応させる) */
export interface PerformanceTableHeads {
  /** 当月(途中の帳簿値)。無ければ null */
  inProgressMonth: number | null;
  /** 概要の「累計・仕掛品振替反映分(または経理確認済み)」の列。対象の月が無ければ null */
  adjusted: { label: string; period: string; monthCount: number } | null;
  /** 概要の「帳簿上の進捗」= 期首から当月までの累計 */
  progress: { label: string; period: string };
}

const DEFAULT_HEADS: PerformanceTableHeads = { inProgressMonth: null, adjusted: null, progress: { label: "当期累計", period: "" } };

function HeadLabel({ label, period }: { label: string; period: string }) {
  return (
    <>
      <span className="block">{label}</span>
      {period && <span className="block font-normal">{period}</span>}
    </>
  );
}

/**
 * 月次業績・採算の表。列は 期首月〜当月 | 累計・仕掛品振替反映分 | 帳簿上の進捗(期首〜当月) | 前年同期累計 | 前年同期比(増減)。
 * 累計の2列は概要の経営サマリーと同じ対象期間・定義で、金額が一致する(2026-11-18)。
 * 値が取れない(未取得・売上0など)セルは「—」で、0円と区別する。
 */
export function PerformanceTable({
  months,
  rows,
  heads = DEFAULT_HEADS,
}: {
  months: number[];
  rows: PerformanceTableRow[];
  heads?: PerformanceTableHeads;
}) {
  const adjustedCount = heads.adjusted?.monthCount ?? 0;
  const adjustedOf = (values: (number | null)[]): number | null => {
    if (!heads.adjusted) return null;
    const xs = values.slice(0, adjustedCount);
    return xs.length === adjustedCount && xs.every((v) => v !== null) ? xs.reduce<number>((s, v) => s + (v as number), 0) : null;
  };
  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)]">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-[var(--surface-sunken)] text-xs font-medium text-[var(--text-muted)]">
            <th className="sticky left-0 z-10 bg-[var(--surface-sunken)] px-3 py-2 text-left">
              <span className="sr-only">項目</span>
            </th>
            {months.map((m) => (
              <th key={m} className="whitespace-nowrap px-3 py-2 text-right align-bottom">
                <HeadLabel label={`${m}月`} period={m === heads.inProgressMonth ? "途中の帳簿値" : ""} />
              </th>
            ))}
            {heads.adjusted && (
              <th className="whitespace-nowrap px-3 py-2 text-right align-bottom">
                <HeadLabel label={heads.adjusted.label} period={heads.adjusted.period} />
              </th>
            )}
            <th className="whitespace-nowrap px-3 py-2 text-right align-bottom">
              <HeadLabel label={heads.progress.label} period={heads.progress.period} />
            </th>
            <th className="whitespace-nowrap px-3 py-2 text-right align-bottom">
              <HeadLabel label="前年同期累計" period={heads.progress.period} />
            </th>
            <th className="whitespace-nowrap px-3 py-2 text-right align-bottom">
              <HeadLabel label="前年同期比" period="増減額（率）" />
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => {
            const sub = row.kind !== "text" && row.sub === true;
            const label = (
              <th
                scope="row"
                className={`sticky left-0 z-10 whitespace-nowrap border-t border-[var(--gridline)] bg-[var(--surface-1)] px-3 py-1.5 text-left font-normal ${
                  sub ? "pl-6 text-xs text-[var(--text-muted)]" : "text-[var(--text-secondary)]"
                }`}
              >
                {row.label}
              </th>
            );
            if (row.kind === "text") {
              return (
                <tr key={rowIndex}>
                  {label}
                  {row.values.map((v, i) => (
                    <Cell key={months[i]} sub>
                      {v}
                    </Cell>
                  ))}
                  <td colSpan={heads.adjusted ? 4 : 3} className="border-t border-[var(--gridline)] px-3 py-1.5 text-xs text-[var(--text-muted)]">
                    {row.note}
                  </td>
                </tr>
              );
            }
            if (row.kind === "rate") {
              const diff =
                row.cumulative === null || row.previousCumulative === null
                  ? null
                  : row.cumulative - row.previousCumulative;
              return (
                <tr key={rowIndex}>
                  {label}
                  {row.values.map((v, i) => (
                    <RateCellKeyed key={months[i]} value={v} sub={sub} />
                  ))}
                  {heads.adjusted && <Cell sub>—</Cell>}
                  {rateCell(row.cumulative, { sub, shaded: true })}
                  {rateCell(row.previousCumulative, { sub: true })}
                  {/* 前年同期比は色を付けない(費用の比率は下がる方が良いため、マイナス=赤は誤解を招く) */}
                  <Cell sub={sub}>
                    {diff === null ? "—" : formatPointDiff(diff)}
                  </Cell>
                </tr>
              );
            }
            return (
              <tr key={rowIndex}>
                {label}
                {row.values.map((v, i) => (
                  <AmountCellKeyed key={months[i]} value={v} sub={sub} bold={row.bold} />
                ))}
                {heads.adjusted && amountCell(sub ? null : adjustedOf(row.values), { sub, bold: row.bold })}
                {amountCell(row.cumulative, { sub, bold: row.bold, shaded: true })}
                {amountCell(row.previousCumulative, { sub: true })}
                <Cell sub={sub}>{sub ? "—" : formatChange(row.cumulative, row.previousCumulative)}</Cell>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function AmountCellKeyed({ value, sub, bold }: { value: number | null; sub: boolean; bold?: boolean }) {
  return amountCell(value, { sub, bold });
}

function RateCellKeyed({ value, sub }: { value: number | null; sub: boolean }) {
  return rateCell(value, { sub });
}
