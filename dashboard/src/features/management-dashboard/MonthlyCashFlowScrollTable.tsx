import { formatYen } from "@/utils/format";
import { EXTERNAL_CASH_FLOW_CALCULATION_VERSION } from "./externalCashFlow";
import { OPERATING_CATEGORIES } from "@/config/freeeExpenseClassification";
import type { ExpenseCategory } from "@/config/freeeExpenseClassification";
import { employeeSalarySubtotal } from "./cashOutflow";
import { RefreshMonthButton } from "./RefreshMonthButton";
import { RefreshTermButton } from "./RefreshTermButton";
import { SectionBanner } from "./SectionBanner";
import type { MonthlyCashFlow } from "./types";

const CATEGORY_LABEL: Record<ExpenseCategory, string> = {
  labor: "給与・人件費",
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
  /** 大区分見出し(月初資金/営業活動/財務・資産活動/参考・調整/資金結果)。表内で明確に区切れる最上位階層 */
  | { kind: "section"; label: string; groupStart?: boolean }
  /** 「入金」「支出」の帯。データ行ではなく小区分の見出し(金額は表示しない、ユーザー確定、2026-09-20) */
  | { kind: "band"; label: string; groupStart?: boolean }
  | {
      kind: "value";
      label: string;
      indent?: boolean;
      bold?: boolean;
      /** 営業キャッシュ収支・当月現金増減など、経営上の主要指標(bold行の中でもさらに目立たせる) */
      keyMetric?: boolean;
      note?: boolean;
      groupStart?: boolean;
      /** 入金・出金の区分別内訳の行。旧ロジック(v3より前)で保存されたスナップショットには値が無く「未再計算」と表示する */
      inflowDetail?: boolean;
      get: (cf: MonthlyCashFlow) => number | null;
    };

/**
 * 月初資金 → 営業活動 → 財務・資産活動 → 参考・調整 → 資金結果、の順で経営上の意味が
 * 分かる構造に並べる(ユーザー確定、2026-09-20)。数値の計算ロジック・分類ロジックは
 * v3.1のまま変更しない。各行のgetは既存フィールドをそのまま参照するのみ
 */
const ROWS: RowDef[] = [
  { kind: "section", label: "月初資金", groupStart: true },
  { kind: "value", label: "月初現預金", bold: true, get: (cf) => cf.cashOpening },

  { kind: "section", label: "営業活動", groupStart: true },
  { kind: "band", label: "入金" },
  { kind: "value", label: "営業入金", indent: true, inflowDetail: true, get: (cf) => cf.inflow?.operating ?? null },
  {
    kind: "value",
    label: "うち帳簿補完(銀行明細欠落)",
    indent: true,
    note: true,
    inflowDetail: true,
    get: (cf) => cf.inflow?.operatingLedgerOnly ?? null,
  },
  { kind: "band", label: "支出" },
  { kind: "value", label: CATEGORY_LABEL.labor, indent: true, get: (cf) => cf.expenseByCategory.labor },
  {
    kind: "value",
    label: "うち従業員給与計",
    indent: true,
    note: true,
    inflowDetail: true,
    // 従業員給与＋従業員賞与＋指定業務委託。役員報酬・役員賞与、退職金、社会保険、福利厚生費は含めない(参考内訳、合計に二重加算しない)
    get: (cf) => (cf.outflow?.laborDetail ? employeeSalarySubtotal(cf.outflow.laborDetail) : null),
  },
  { kind: "value", label: CATEGORY_LABEL.outsourcing, indent: true, get: (cf) => cf.expenseByCategory.outsourcing },
  { kind: "value", label: CATEGORY_LABEL.taxSocial, indent: true, get: (cf) => cf.expenseByCategory.taxSocial },
  { kind: "value", label: CATEGORY_LABEL.otherOperating, indent: true, get: (cf) => cf.expenseByCategory.otherOperating },
  { kind: "value", label: CATEGORY_LABEL.other, indent: true, get: (cf) => cf.expenseByCategory.other },
  {
    kind: "value",
    label: "営業支出合計",
    bold: true,
    get: (cf) => OPERATING_CATEGORIES.reduce((sum, c) => sum + cf.expenseByCategory[c], 0),
  },
  {
    kind: "value",
    label: "営業キャッシュ収支（営業入金−営業支出）",
    bold: true,
    keyMetric: true,
    get: (cf) => cf.operatingCashFlow,
  },

  { kind: "section", label: "財務・資産活動", groupStart: true },
  { kind: "band", label: "入金" },
  { kind: "value", label: "借入による入金", indent: true, inflowDetail: true, get: (cf) => cf.inflow?.borrowing ?? null },
  {
    kind: "value",
    label: "保険・資産回収等",
    indent: true,
    inflowDetail: true,
    get: (cf) => cf.inflow?.assetRecovery ?? null,
  },
  { kind: "value", label: "その他", indent: true, inflowDetail: true, get: (cf) => cf.inflow?.other ?? null },
  { kind: "value", label: "未分類", indent: true, inflowDetail: true, get: (cf) => cf.inflow?.unclassified ?? null },
  { kind: "band", label: "支出" },
  { kind: "value", label: CATEGORY_LABEL.financing, indent: true, get: (cf) => cf.financingCashFlow },
  { kind: "value", label: CATEGORY_LABEL.interest, indent: true, get: (cf) => cf.interestCashFlow },
  { kind: "value", label: "借入関連支出合計", bold: true, get: (cf) => cf.financingCashFlow + cf.interestCashFlow },
  { kind: "value", label: CATEGORY_LABEL.assetTransfer, indent: true, get: (cf) => cf.assetTransferCashFlow },
  {
    kind: "value",
    label: "未分類（出金）",
    indent: true,
    inflowDetail: true,
    get: (cf) => cf.outflow?.unclassified ?? null,
  },

  { kind: "section", label: "参考・調整", groupStart: true },
  {
    kind: "value",
    label: "内部移動（入金） ※合計に含めず",
    indent: true,
    note: true,
    inflowDetail: true,
    get: (cf) => cf.inflow?.internalTransfer ?? null,
  },
  {
    kind: "value",
    label: "内部移動（出金） ※合計に含めず",
    indent: true,
    note: true,
    inflowDetail: true,
    get: (cf) => cf.outflow?.internalTransfer ?? null,
  },
  {
    kind: "value",
    label: "ネットゼロ往復（入金） ※帳簿未計上・合計に含めず",
    indent: true,
    note: true,
    inflowDetail: true,
    get: (cf) => cf.inflow?.netZeroRoundTrip ?? null,
  },
  {
    kind: "value",
    label: "ネットゼロ往復（出金） ※帳簿未計上・合計に含めず",
    indent: true,
    note: true,
    inflowDetail: true,
    get: (cf) => cf.outflow?.netZeroRoundTrip ?? null,
  },
  {
    kind: "value",
    label: "帳簿補完（出金側）",
    indent: true,
    note: true,
    inflowDetail: true,
    get: (cf) => cf.outflow?.ledgerOnly ?? null,
  },
  {
    kind: "value",
    label: "検算差額（現金増減−(入金−出金)）",
    note: true,
    get: (cf) => (cf.cashChange === null ? null : cf.cashChange - (cf.externalIncome - cf.externalExpenseTotal)),
  },

  { kind: "section", label: "資金結果", groupStart: true },
  { kind: "value", label: "キャッシュイン合計", bold: true, get: (cf) => cf.externalIncome },
  { kind: "value", label: "キャッシュアウト合計（外部支出）", bold: true, get: (cf) => cf.externalExpenseTotal },
  {
    kind: "value",
    label: "当月現金増減",
    bold: true,
    keyMetric: true,
    get: (cf) => cf.cashChange ?? cf.externalIncome - cf.externalExpenseTotal,
  },
  { kind: "value", label: "月末現預金", bold: true, get: (cf) => cf.cashClosing },
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
 *
 * 行の視覚的な階層(ユーザー確定、2026-09-20):
 * 1. セクション(月初資金/営業活動/財務・資産活動/参考・調整/資金結果): 全列
 *    bg-surface-sunken・太字の見出し行、上に太罫線。
 * 2. 小区分(入金/支出): 全列bg-surface-band-deep(濃いベージュ)の帯、金額は表示しない。
 * 3. 通常明細(営業入金・給与・人件費など): 列単位のシマシマ背景、通常の文字色。
 * 4. 補足内訳(うち従業員給与計など): インデント+文字色を一段弱く。
 * 集計行(営業支出合計・キャッシュイン合計など)は太字を維持しつつ、経営上の主要指標
 * (営業キャッシュ収支・当月現金増減)はkeyMetricでさらに太罫線+太字にして目立たせる。
 * 色を増やしすぎないよう、階層はベージュの濃淡・罫線・font-weightのみで作る。
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
                    {col.cashFlow && col.cashFlow.calculationVersion !== EXTERNAL_CASH_FLOW_CALCULATION_VERSION && (
                      <span
                        className="rounded bg-[var(--status-warning)] px-1 py-0.5 text-[10px] font-bold text-white"
                        title="入金・出金の区分内訳は旧ロジックで保存された値のため未反映です(合計も旧ロジックの値)。「更新」で再計算されます"
                      >
                        旧ロジック
                      </span>
                    )}
                    {col.cashFlow?.status === "provisional" && (
                      <span
                        className="rounded bg-[var(--status-warning)] px-1 py-0.5 text-[10px] font-bold text-white"
                        title={
                          (col.cashFlow.inflow?.unclassified ?? 0) !== 0 || (col.cashFlow.outflow?.unclassified ?? 0) !== 0
                            ? "未分類の入金・出金あり(仕訳科目でも摘要ルールでも判定できないため分類していない)"
                            : "49期固有の証拠付き補完・除外(銀行明細欠落の帳簿補完、帳簿未計上の往復)を適用済み"
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
                      className={`sticky left-0 z-10 ${LABEL_COL_WIDTH} ${rowBorder} bg-[var(--surface-sunken)] px-3 py-2 text-sm font-semibold text-[var(--text-primary)]`}
                    >
                      {row.label}
                    </td>
                    {columns.map((col) => (
                      <td
                        key={`${col.fiscalYear}-${col.month}-${col.isTermTotal ? "total" : "month"}`}
                        className={`${MONTH_COL_WIDTH} ${rowBorder} bg-[var(--surface-sunken)]`}
                      />
                    ))}
                  </tr>
                );
              }

              if (row.kind === "band") {
                return (
                  <tr key={row.label}>
                    <td
                      className={`sticky left-0 z-10 ${LABEL_COL_WIDTH} ${rowBorder} bg-[var(--surface-band-deep)] px-3 py-1.5 pl-6 text-xs font-medium text-[var(--text-secondary)]`}
                    >
                      {row.label}
                    </td>
                    {columns.map((col) => (
                      <td
                        key={`${col.fiscalYear}-${col.month}-${col.isTermTotal ? "total" : "month"}`}
                        className={`${MONTH_COL_WIDTH} ${rowBorder} bg-[var(--surface-band-deep)]`}
                      />
                    ))}
                  </tr>
                );
              }

              const keyMetricBorder = row.keyMetric ? "border-y-2 border-[var(--baseline)]" : rowBorder;
              const keyMetricBg = row.keyMetric ? "bg-[var(--surface-sunken)]" : "";
              const textClass = row.note
                ? "text-xs text-[var(--text-muted)]"
                : row.keyMetric
                  ? "font-bold text-[var(--text-primary)]"
                  : row.bold
                    ? "font-semibold text-[var(--text-primary)]"
                    : "text-[var(--text-secondary)]";
              const valueClass = row.note
                ? "text-xs text-[var(--text-muted)]"
                : row.keyMetric
                  ? "font-bold text-[var(--text-primary)]"
                  : row.bold
                    ? "font-semibold text-[var(--text-primary)]"
                    : "text-[var(--text-primary)]";

              return (
                <tr key={row.label}>
                  <td
                    className={`sticky left-0 z-10 ${LABEL_COL_WIDTH} ${keyMetricBorder} ${keyMetricBg || LABEL_COL_BG} px-3 py-1.5 ${row.indent ? "pl-6" : ""} ${textClass}`}
                  >
                    {row.label}
                  </td>
                  {columns.map((col, colIndex) => (
                    <td
                      key={`${col.fiscalYear}-${col.month}-${col.isTermTotal ? "total" : "month"}`}
                      className={`${MONTH_COL_WIDTH} ${keyMetricBorder} ${keyMetricBg || monthColBg(colIndex)} px-3 py-1.5 text-right tabular-nums ${valueClass}`}
                    >
                      {col.cashFlow
                        ? row.inflowDetail && row.get(col.cashFlow) === null
                          ? "未再計算"
                          : formatCell(row.get(col.cashFlow))
                        : "データ未設定"}
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

export { ROWS as __ROWS_FOR_TEST__ };
