import { formatPercent } from "@/utils/format";

/** 表の1行。金額は千円単位、比率は%で表示する */
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

/** 千円単位・桁区切り。マイナスは▲(経営サマリーと同じ表記) */
function formatThousand(value: number): string {
  const thousand = Math.round(value / 1000);
  return thousand < 0 ? `▲${Math.abs(thousand).toLocaleString("ja-JP")}` : thousand.toLocaleString("ja-JP");
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
      {value === null ? "—" : formatThousand(value)}
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

/**
 * 月次業績・採算の表。列は 期首月〜当月 | 当期累計 | 前年同期累計 | 前年同期比。
 * 値が取れない(未取得・売上0など)セルは「—」で、0円と区別する。
 */
export function PerformanceTable({ months, rows }: { months: number[]; rows: PerformanceTableRow[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)]">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-[var(--surface-sunken)] text-xs font-medium text-[var(--text-muted)]">
            <th className="sticky left-0 z-10 bg-[var(--surface-sunken)] px-3 py-2 text-left">（千円）</th>
            {months.map((m) => (
              <th key={m} className="whitespace-nowrap px-3 py-2 text-right">
                {m}月
              </th>
            ))}
            <th className="whitespace-nowrap px-3 py-2 text-right">当期累計</th>
            <th className="whitespace-nowrap px-3 py-2 text-right">前年同期累計</th>
            <th className="whitespace-nowrap px-3 py-2 text-right">前年同期比</th>
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
                  <td colSpan={3} className="border-t border-[var(--gridline)] px-3 py-1.5 text-xs text-[var(--text-muted)]">
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
                {amountCell(row.cumulative, { sub, bold: row.bold, shaded: true })}
                {amountCell(row.previousCumulative, { sub: true })}
                <Cell sub={sub}>
                  {row.changeRate === undefined || row.changeRate === null ? "—" : formatChangeRate(row.changeRate)}
                </Cell>
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
