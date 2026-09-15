import { formatYen } from "@/utils/format";
import { OPERATING_CATEGORIES } from "@/config/freeeExpenseClassification";
import type { ExpenseCategory } from "@/config/freeeExpenseClassification";
import { RefreshMonthButton } from "./RefreshMonthButton";
import { SectionBanner } from "./SectionBanner";
import type { MonthlyCashFlow } from "./types";

const CATEGORY_LABEL: Record<ExpenseCategory, string> = {
  labor: "人件費",
  outsourcing: "外注費",
  taxSocial: "税金・社会保険等",
  otherOperating: "諸経費",
  other: "その他",
  financing: "当月元本返済",
  interest: "支払利息",
  assetTransfer: "積立・資産移動",
};

/** 横スクロール表の1列(1ヶ月分)。cashFlowが取得できなかった月はnull(データ未設定として表示) */
export interface MonthColumn {
  fiscalYear: number;
  term: number;
  month: number;
  calendarYear: number;
  /** 現在時刻から見て「当月」かどうか(軽い強調表示用) */
  isCurrent: boolean;
  cashFlow: MonthlyCashFlow | null;
}

type RowDef =
  | { kind: "section"; label: string; groupStart?: boolean }
  | {
      kind: "value";
      label: string;
      indent?: boolean;
      bold?: boolean;
      note?: boolean;
      groupStart?: boolean;
      get: (cf: MonthlyCashFlow) => number | null;
    };

const ROWS: RowDef[] = [
  { kind: "value", label: "月初現預金", bold: true, get: (cf) => cf.cashOpening },
  { kind: "section", label: "入金", groupStart: true },
  { kind: "value", label: "外部入金", indent: true, get: (cf) => cf.externalIncome },
  { kind: "section", label: "支出" },
  { kind: "value", label: CATEGORY_LABEL.labor, indent: true, get: (cf) => cf.expenseByCategory.labor },
  { kind: "value", label: CATEGORY_LABEL.outsourcing, indent: true, get: (cf) => cf.expenseByCategory.outsourcing },
  { kind: "value", label: CATEGORY_LABEL.taxSocial, indent: true, get: (cf) => cf.expenseByCategory.taxSocial },
  { kind: "value", label: CATEGORY_LABEL.otherOperating, indent: true, get: (cf) => cf.expenseByCategory.otherOperating },
  { kind: "value", label: CATEGORY_LABEL.other, indent: true, get: (cf) => cf.expenseByCategory.other },
  {
    kind: "value",
    label: "内訳合計",
    bold: true,
    get: (cf) => OPERATING_CATEGORIES.reduce((sum, c) => sum + cf.expenseByCategory[c], 0),
  },
  { kind: "value", label: "営業キャッシュ収支", bold: true, get: (cf) => cf.operatingCashFlow },
  { kind: "section", label: "財務・将来準備", groupStart: true },
  { kind: "value", label: CATEGORY_LABEL.financing, indent: true, get: (cf) => cf.financingCashFlow },
  { kind: "value", label: CATEGORY_LABEL.interest, indent: true, get: (cf) => cf.interestCashFlow },
  { kind: "value", label: "借入関連支出合計", bold: true, get: (cf) => cf.financingCashFlow + cf.interestCashFlow },
  { kind: "value", label: CATEGORY_LABEL.assetTransfer, indent: true, get: (cf) => cf.assetTransferCashFlow },
  { kind: "value", label: "外部支出（実績）", bold: true, get: (cf) => cf.externalExpenseTotal },
  {
    kind: "value",
    label: "調整・未分類差額",
    note: true,
    get: (cf) => (cf.cashChange === null ? null : cf.cashChange - (cf.externalIncome - cf.externalExpenseTotal)),
  },
  {
    kind: "value",
    label: "当月現金増減",
    bold: true,
    get: (cf) => cf.cashChange ?? cf.externalIncome - cf.externalExpenseTotal,
  },
  { kind: "value", label: "月末現預金", bold: true, groupStart: true, get: (cf) => cf.cashClosing },
];

const LABEL_COL_WIDTH = "w-52 min-w-52";
const MONTH_COL_WIDTH = "w-40 min-w-40";

function formatCell(value: number | null): string {
  return value === null ? "データ未設定" : formatYen(value);
}

/**
 * 月次資金収支の横スクロール表(ユーザー確定、2026-09-15)。項目を縦に、月を横に並べる。
 * 左端の項目列はsticky、各月列は幅固定(桁数が変わってもレイアウトが崩れないように)。
 * 初期実装では前月・当月の2列のみ(10月以降の自動追加は次フェーズ)。
 *
 * 列ごとのデータソースは呼び出し側(page.tsx)が決める: 過去月はFirestore優先、
 * 当月はアクセスごとにfreeeライブ取得(既存のgetOrFetchMonthlyCashFlowをそのまま利用、
 * 計算ロジック自体は変更していない)。
 */
export function MonthlyCashFlowScrollTable({ columns }: { columns: MonthColumn[] }) {
  return (
    <div className="flex flex-col gap-2">
      <SectionBanner>月次資金収支（会社版家計簿）</SectionBanner>

      <div className="overflow-x-auto rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)]">
        <table className="w-full table-fixed border-collapse text-sm">
          <thead>
            <tr>
              <th
                className={`sticky left-0 z-10 ${LABEL_COL_WIDTH} border-b border-[var(--gridline)] bg-[var(--surface-sunken)] px-3 py-2 text-left text-xs font-medium text-[var(--text-muted)]`}
              >
                項目
              </th>
              {columns.map((col) => (
                <th
                  key={`${col.fiscalYear}-${col.month}`}
                  className={`${MONTH_COL_WIDTH} border-b border-[var(--gridline)] px-3 py-2 text-right align-bottom ${
                    col.isCurrent ? "bg-[var(--surface-sunken)]" : ""
                  }`}
                >
                  <div className="flex items-center justify-end gap-1 whitespace-nowrap text-sm font-semibold text-[var(--text-primary)]">
                    {col.calendarYear}年{col.month}月
                    {col.isCurrent && (
                      <span className="rounded bg-[var(--band-bg)] px-1 py-0.5 text-[10px] font-bold text-white">
                        当月
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex justify-end">
                    <RefreshMonthButton fiscalYear={col.fiscalYear} month={col.month} />
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row, rowIndex) => {
              const rowBorder = row.groupStart ? "border-t-2 border-[var(--baseline)]" : "border-t border-[var(--gridline)]";
              // 項目・各月列すべてに、行単位で交互に背景色を入れる(ユーザー確定、2026-09-15)
              const zebraBg = rowIndex % 2 === 0 ? "bg-[var(--surface-1)]" : "bg-[var(--surface-sunken)]";

              if (row.kind === "section") {
                return (
                  <tr key={row.label}>
                    <td
                      className={`sticky left-0 z-10 ${LABEL_COL_WIDTH} ${rowBorder} ${zebraBg} px-3 py-1.5 text-xs font-medium text-[var(--text-muted)]`}
                    >
                      {row.label}
                    </td>
                    {columns.map((col) => (
                      <td key={`${col.fiscalYear}-${col.month}`} className={`${MONTH_COL_WIDTH} ${rowBorder} ${zebraBg}`} />
                    ))}
                  </tr>
                );
              }

              const textClass = row.note
                ? "text-xs text-[var(--text-muted)]"
                : row.bold
                  ? "font-semibold text-[var(--text-primary)]"
                  : "text-[var(--text-secondary)]";
              const valueClass = row.note
                ? "text-xs text-[var(--text-muted)]"
                : row.bold
                  ? "font-semibold text-[var(--text-primary)]"
                  : "text-[var(--text-primary)]";

              return (
                <tr key={row.label}>
                  <td
                    className={`sticky left-0 z-10 ${LABEL_COL_WIDTH} ${rowBorder} ${zebraBg} px-3 py-1.5 ${row.indent ? "pl-6" : ""} ${textClass}`}
                  >
                    {row.label}
                  </td>
                  {columns.map((col) => (
                    <td
                      key={`${col.fiscalYear}-${col.month}`}
                      className={`${MONTH_COL_WIDTH} ${rowBorder} ${zebraBg} px-3 py-1.5 text-right tabular-nums ${valueClass}`}
                    >
                      {col.cashFlow ? formatCell(row.get(col.cashFlow)) : "データ未設定"}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
