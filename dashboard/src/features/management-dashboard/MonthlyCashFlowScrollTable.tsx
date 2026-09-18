import { formatYen } from "@/utils/format";
import { OPERATING_CATEGORIES } from "@/config/freeeExpenseClassification";
import type { ExpenseCategory } from "@/config/freeeExpenseClassification";
import { RefreshMonthButton } from "./RefreshMonthButton";
import { RefreshTermButton } from "./RefreshTermButton";
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

/** 横スクロール表の1列(1ヶ月分、またはisTermTotal=trueの場合は1期分の通期合計)。
 * cashFlowが取得できなかった月/期はnull(データ未設定として表示) */
export interface MonthColumn {
  fiscalYear: number;
  term: number;
  month: number;
  calendarYear: number;
  /** 現在時刻から見て「当月」かどうか(軽い強調表示用) */
  isCurrent: boolean;
  cashFlow: MonthlyCashFlow | null;
  /**
   * 期別通期スナップショット(termCashFlowSnapshots)の列かどうか。trueの場合、
   * ヘッダーは「{calendarYear}年{month}月（{term}期通期）」形式(期末月も含めて表示)、
   * ヘッダー背景色つき、「この期をfreeeから更新」ボタン(RefreshTermButton、
   * 月次とは別のFirestoreドキュメントを更新する)を表示する(ユーザー確定、2026-09-18)。
   */
  isTermTotal?: boolean;
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

// 項目列は常に背景あり、月列は列単位で背景あり/なしを交互にする(タテのシマシマ、
// ユーザー確定、2026-09-15)。行単位ではなく列単位で交互にする点に注意
const LABEL_COL_BG = "bg-[var(--surface-sunken)]";
function monthColBg(colIndex: number): string {
  return colIndex % 2 === 0 ? "bg-[var(--surface-1)]" : "bg-[var(--surface-sunken)]";
}

function formatCell(value: number | null): string {
  return value === null ? "データ未設定" : formatYen(value);
}

/**
 * 月次資金収支の横スクロール表(ユーザー確定、2026-09-15)。項目を縦に、月を横に並べる。
 * 左端の項目列はsticky、各月列は幅固定(桁数が変わってもレイアウトが崩れないように)。
 * 列数はcolumnsの長さに追従するだけで、ここに列数の上限は無い(基準月〜当月まで
 * 月が進むごとに自動で列が増える設計。列の組み立てはpage.tsx側で行う、
 * ユーザー確定、2026-09-15)。
 *
 * 列ごとのデータソースは呼び出し側(page.tsx)が決める。当月を含む全月列とも常に
 * Firestoreキャッシュ優先で読む(アクセスごとのfreeeライブ取得は行わない、
 * ユーザー確定、2026-09-18。ローディングを軽くするため)。月列は「この月をfreeeから
 * 更新」、isTermTotal=true(期別通期合計)列は「この期をfreeeから更新」ボタンを
 * それぞれ表示し、どちらも個別に再取得できるようにする(termCashFlowSnapshots、
 * ユーザー確定、2026-09-18)。
 *
 * ヘッダーの背景色は期別通期合計列のみに付ける(isTermTotal、例:
 * 「2026年8月（49期通期）」)。当月列も含め、それ以外の通常月列はヘッダー背景を
 * 付けない(白のまま)。当月の強調は「当月」バッジのみで行う(ユーザー確定、2026-09-18)。
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
                  key={`${col.fiscalYear}-${col.month}-${col.isTermTotal ? "total" : "month"}`}
                  className={`${MONTH_COL_WIDTH} border-b border-[var(--gridline)] px-3 py-2 text-right align-bottom ${
                    col.isTermTotal ? "bg-[var(--surface-sunken)]" : ""
                  }`}
                >
                  <div className="flex items-center justify-end gap-1 whitespace-nowrap text-sm font-semibold text-[var(--text-primary)]">
                    {col.isTermTotal ? (
                      <>
                        {col.calendarYear}年{col.month}月（{col.term}期通期）
                      </>
                    ) : (
                      <>{col.calendarYear}年{col.month}月</>
                    )}
                    {col.isCurrent && (
                      <span className="rounded bg-[var(--band-bg)] px-1 py-0.5 text-[10px] font-bold text-white">
                        当月
                      </span>
                    )}
                    {col.cashFlow?.status === "provisional" && (
                      <span
                        className="rounded bg-[var(--status-warning)] px-1 py-0.5 text-[10px] font-bold text-white"
                        title={
                          col.cashFlow.unresolvedItems.length > 0
                            ? `未解決明細${col.cashFlow.unresolvedItems.length}件あり(外部入金・外部支出に含む。分類未確定)`
                            : "証拠付きoverride適用済み、または確定に至っていない候補あり"
                        }
                      >
                        暫定
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex justify-end">
                    {col.isTermTotal ? (
                      <RefreshTermButton term={col.term} />
                    ) : (
                      <RefreshMonthButton fiscalYear={col.fiscalYear} month={col.month} />
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => {
              const rowBorder = row.groupStart ? "border-t-2 border-[var(--baseline)]" : "border-t border-[var(--gridline)]";

              if (row.kind === "section") {
                return (
                  <tr key={row.label}>
                    <td
                      className={`sticky left-0 z-10 ${LABEL_COL_WIDTH} ${rowBorder} ${LABEL_COL_BG} px-3 py-1.5 text-xs font-medium text-[var(--text-muted)]`}
                    >
                      {row.label}
                    </td>
                    {columns.map((col, colIndex) => (
                      <td
                        key={`${col.fiscalYear}-${col.month}-${col.isTermTotal ? "total" : "month"}`}
                        className={`${MONTH_COL_WIDTH} ${rowBorder} ${monthColBg(colIndex)}`}
                      />
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
                    className={`sticky left-0 z-10 ${LABEL_COL_WIDTH} ${rowBorder} ${LABEL_COL_BG} px-3 py-1.5 ${row.indent ? "pl-6" : ""} ${textClass}`}
                  >
                    {row.label}
                  </td>
                  {columns.map((col, colIndex) => (
                    <td
                      key={`${col.fiscalYear}-${col.month}-${col.isTermTotal ? "total" : "month"}`}
                      className={`${MONTH_COL_WIDTH} ${rowBorder} ${monthColBg(colIndex)} px-3 py-1.5 text-right tabular-nums ${valueClass}`}
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
