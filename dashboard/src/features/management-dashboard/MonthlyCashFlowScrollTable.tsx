"use client";

import { useState } from "react";
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
  /** 「入金」「支出」「借入返済」「資産移動」の小区分見出し。データ行ではなくラベルのみ(金額は表示しない) */
  | { kind: "band"; label: string }
  | {
      kind: "value";
      label: string;
      indent?: boolean;
      bold?: boolean;
      /** 営業キャッシュ収支・当月現金増減など、経営上の主要指標(bold行の中でもさらに目立たせる) */
      keyMetric?: boolean;
      /** 月末現預金。表全体の最終到達点として最も強く強調する(keyMetricよりさらに上の階層) */
      finalMetric?: boolean;
      /** trueの場合、マイナス値のセルのみ既存の赤系ステータス色(--status-serious)で表示する */
      negativeRed?: boolean;
      note?: boolean;
      /** 入金・出金の区分別内訳の行。旧ロジック(v3より前)で保存されたスナップショットには値が無く「未再計算」と表示する */
      inflowDetail?: boolean;
      get: (cf: MonthlyCashFlow) => number | null;
    };

/** 表冒頭に単独で表示する月初現預金。大区分見出しは持たず、値だけを表示する
 * (「月初資金」という見出しは置かない、ユーザー確定、2026-09-21) */
const OPENING_ROW: Extract<RowDef, { kind: "value" }> = {
  kind: "value",
  label: "月初現預金",
  bold: true,
  get: (cf) => cf.cashOpening,
};

interface SectionDef {
  key: string;
  title: string;
  /** 参考・調整のみtrue。経営判断上の優先度が低いため見出しを弱くし、折りたたみ式にする(既定で折りたたみ、ユーザー確定、2026-09-21) */
  muted?: boolean;
  rows: RowDef[];
}

/**
 * 営業活動 → 財務・資産活動 → 参考・調整 → 資金結果、の順で経営上の意味が分かる構造に
 * 並べる(ユーザー確定、2026-09-20/21)。数値の計算ロジック・分類ロジックはv3.1のまま
 * 変更しない。各行のgetは既存フィールドをそのまま参照するのみ。
 *
 * 4区分(営業活動/財務・資産活動/参考・調整/資金結果)はそれぞれ独立したタイル(カード)として
 * 閉じて分ける(ユーザー確定、2026-09-21)。見出しの強さの競合を避けるため、表内の行として
 * 大区分見出しを描画するのではなく、タイルの外枠自体で区分を表現する。
 */
const SECTIONS: SectionDef[] = [
  {
    key: "operating",
    title: "営業活動",
    rows: [
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
      {
        kind: "value",
        label: CATEGORY_LABEL.otherOperating,
        indent: true,
        get: (cf) => cf.expenseByCategory.otherOperating,
      },
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
        negativeRed: true,
        get: (cf) => cf.operatingCashFlow,
      },
    ],
  },
  {
    // 財務・資産活動は「入金/借入返済/資産移動」の3小区分に整理する(ユーザー確定、2026-09-21。
    // 「支出」という一括りだと、借入の返済と資産移動という性質の異なる資金使途が混ざって見えるため)
    key: "financing",
    title: "財務・資産活動",
    rows: [
      { kind: "band", label: "入金" },
      {
        kind: "value",
        label: "借入による入金",
        indent: true,
        inflowDetail: true,
        get: (cf) => cf.inflow?.borrowing ?? null,
      },
      {
        kind: "value",
        label: "保険・資産回収等",
        indent: true,
        inflowDetail: true,
        get: (cf) => cf.inflow?.assetRecovery ?? null,
      },
      { kind: "value", label: "その他", indent: true, inflowDetail: true, get: (cf) => cf.inflow?.other ?? null },
      { kind: "value", label: "未分類", indent: true, inflowDetail: true, get: (cf) => cf.inflow?.unclassified ?? null },
      { kind: "band", label: "借入返済" },
      { kind: "value", label: CATEGORY_LABEL.financing, indent: true, get: (cf) => cf.financingCashFlow },
      { kind: "value", label: CATEGORY_LABEL.interest, indent: true, get: (cf) => cf.interestCashFlow },
      { kind: "value", label: "借入関連支出合計", bold: true, get: (cf) => cf.financingCashFlow + cf.interestCashFlow },
      { kind: "band", label: "資産移動" },
      { kind: "value", label: CATEGORY_LABEL.assetTransfer, indent: true, get: (cf) => cf.assetTransferCashFlow },
      {
        kind: "value",
        label: "未分類（出金）",
        indent: true,
        inflowDetail: true,
        get: (cf) => cf.outflow?.unclassified ?? null,
      },
    ],
  },
  {
    key: "reference",
    title: "参考・調整",
    muted: true,
    rows: [
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
    ],
  },
  {
    key: "result",
    title: "資金結果",
    rows: [
      { kind: "value", label: "キャッシュイン合計", bold: true, get: (cf) => cf.externalIncome },
      { kind: "value", label: "キャッシュアウト合計（外部支出）", bold: true, get: (cf) => cf.externalExpenseTotal },
      {
        kind: "value",
        label: "当月現金増減",
        bold: true,
        keyMetric: true,
        negativeRed: true,
        get: (cf) => cf.cashChange ?? cf.externalIncome - cf.externalExpenseTotal,
      },
      { kind: "value", label: "月末現預金", finalMetric: true, get: (cf) => cf.cashClosing },
    ],
  },
];

const LABEL_COL_WIDTH = "w-52 min-w-52";
const MONTH_COL_WIDTH = "w-40 min-w-40";

// 色はすべて「列」で切り替える(行の背景で階層を作らない、ユーザー確定、2026-09-21)。
// 項目列は常に背景あり、月列は列単位で背景あり/なしを交互にする(タテのシマシマ)。
// 階層はfont-weight・文字サイズ・罫線の太さ・インデント・(マイナス値のみ)文字色だけで表現する
const LABEL_COL_BG = "bg-[var(--surface-sunken)]";
function monthColBg(colIndex: number): string {
  return colIndex % 2 === 0 ? "bg-[var(--surface-1)]" : "bg-[var(--surface-sunken)]";
}

function formatCell(value: number | null): string {
  return value === null ? "データ未設定" : formatYen(value);
}

function ValueRow({ row, columns }: { row: Extract<RowDef, { kind: "value" }>; columns: MonthColumn[] }) {
  const rowBorder = row.finalMetric
    ? "border-y-4 border-[var(--band-bg)]"
    : row.keyMetric
      ? "border-y-2 border-[var(--baseline)]"
      : "border-t border-[var(--gridline)]";
  const rowPadding = row.finalMetric ? "py-2.5" : "py-1.5";
  const textSize = row.note ? "text-xs" : row.finalMetric ? "text-base" : "text-sm";
  const fontWeight = row.note
    ? ""
    : row.finalMetric || row.keyMetric
      ? "font-bold"
      : row.bold
        ? "font-semibold"
        : "";
  const labelColor = row.note
    ? "text-[var(--text-muted)]"
    : row.bold || row.finalMetric
      ? "text-[var(--text-primary)]"
      : "text-[var(--text-secondary)]";
  const indentClass = row.note ? "pl-9" : row.indent ? "pl-6" : "";

  return (
    <tr>
      <td
        className={`sticky left-0 z-10 ${LABEL_COL_WIDTH} ${rowBorder} ${LABEL_COL_BG} px-3 ${rowPadding} ${indentClass} ${textSize} ${fontWeight} ${labelColor}`}
      >
        {row.label}
      </td>
      {columns.map((col, colIndex) => {
        const value = col.cashFlow ? row.get(col.cashFlow) : null;
        const isNegative = row.negativeRed && value !== null && value < 0;
        const valueColor = isNegative
          ? "text-[var(--status-serious)]"
          : row.note
            ? "text-[var(--text-muted)]"
            : "text-[var(--text-primary)]";
        return (
          <td
            key={`${col.fiscalYear}-${col.month}-${col.isTermTotal ? "total" : "month"}`}
            className={`${MONTH_COL_WIDTH} ${rowBorder} ${monthColBg(colIndex)} px-3 ${rowPadding} text-right tabular-nums ${textSize} ${fontWeight} ${valueColor}`}
          >
            {col.cashFlow ? (row.inflowDetail && value === null ? "未再計算" : formatCell(value)) : "データ未設定"}
          </td>
        );
      })}
    </tr>
  );
}

function BandRow({ label, columns }: { label: string; columns: MonthColumn[] }) {
  return (
    <tr>
      <td
        className={`sticky left-0 z-10 ${LABEL_COL_WIDTH} border-t border-[var(--gridline)] ${LABEL_COL_BG} px-3 py-1 pl-6 text-xs font-medium text-[var(--text-secondary)]`}
      >
        {label}
      </td>
      {columns.map((col, colIndex) => (
        <td
          key={`${col.fiscalYear}-${col.month}-${col.isTermTotal ? "total" : "month"}`}
          className={`${MONTH_COL_WIDTH} border-t border-[var(--gridline)] ${monthColBg(colIndex)}`}
        />
      ))}
    </tr>
  );
}

/** 営業活動/財務・資産活動/参考・調整/資金結果を、それぞれ独立したタイル(カード)として
 * 閉じて表示する(ユーザー確定、2026-09-21)。「参考・調整」だけは見出しを弱くし、
 * クリックで折りたたみ可能にする(既定で折りたたみ)。全タイルは共通の横スクロール
 * コンテナ(MonthlyCashFlowScrollTable側)に収め、各タイルが個別のスクロールを持たない
 * ようにすることで、月列の位置がタイル間でずれないようにする */
function SectionTile({
  section,
  columns,
  expanded,
  onToggle,
}: {
  section: SectionDef;
  columns: MonthColumn[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const showRows = !section.muted || expanded;
  return (
    <div className="flex flex-col gap-2">
      {section.muted ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="w-full rounded-md bg-[var(--surface-sunken)] px-3 py-2 text-left text-sm font-semibold text-[var(--text-secondary)]"
        >
          {expanded ? "▼ " : "▶ "}
          {section.title}
        </button>
      ) : (
        <SectionBanner>{section.title}</SectionBanner>
      )}
      {showRows && (
        <div className="overflow-hidden rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)]">
          <table className="w-full table-fixed border-collapse text-sm">
            <tbody>
              {section.rows.map((row) =>
                row.kind === "band" ? (
                  <BandRow key={row.label} label={row.label} columns={columns} />
                ) : (
                  <ValueRow key={row.label} row={row} columns={columns} />
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * 月次資金収支の横スクロール表(ユーザー確定、2026-09-15、2026-09-20/21に情報設計を再調整)。
 * 項目を縦に、月を横に並べる。左端の項目列はsticky、各月列は幅固定(桁数が変わっても
 * レイアウトが崩れないように)。列数はcolumnsの長さに追従するだけで、ここに列数の上限は
 * 無い(基準月〜当月まで月が進むごとに自動で列が増える設計。列の組み立てはpage.tsx側で
 * 行う、ユーザー確定、2026-09-15)。
 *
 * 列ごとのデータソースは呼び出し側(page.tsx)が決める。当月を含む全月列とも常に
 * Firestoreキャッシュ優先で読む(アクセスごとのfreeeライブ取得は行わない、ユーザー確定、
 * 2026-09-18。ローディングを軽くするため)。月列は「この月をfreeeから更新」、
 * isTermTotal=true(期別通期合計)列は「この期をfreeeから更新」ボタンをそれぞれ表示し、
 * どちらも個別に再取得できるようにする(termCashFlowSnapshots、ユーザー確定、2026-09-18)。
 *
 * ヘッダーの背景色は期別通期合計列のみに付ける(isTermTotal、例:
 * 「2026年8月（49期通期）」)。当月列も含め、それ以外の通常月列はヘッダー背景を
 * 付けない(白のまま)。当月の強調は「当月」バッジのみで行う(ユーザー確定、2026-09-18)。
 *
 * 情報設計(ユーザー確定、2026-09-20/21):
 * - 表は「月初現預金」(見出しなし、単独の値)から始まり、営業活動→財務・資産活動→
 *   参考・調整→資金結果の4タイルへ続く。各タイルは独立したカードとして閉じて分け、
 *   タイルの外枠自体で区分の強さを表す(表内の行として大区分見出しを描画しない)。
 * - 4タイルすべてを同じ横スクロールコンテナに収めることで、月列の位置がタイル間で
 *   ずれないようにする(タイルごとに個別のoverflow-x-autoを持たせない)。
 * - タイル内の階層は行の背景色による帯を使わず、font-weight・文字サイズ・罫線の太さ・
 *   インデント・(マイナス値のみ)文字色だけで表現する。小区分(入金/支出/借入返済/資産移動)
 *   はラベルのみで金額を表示しない。集計行(営業支出合計・キャッシュイン合計など)は
 *   font-semibold、営業キャッシュ収支・当月現金増減はfont-bold+上下太罫線でさらに強調し、
 *   マイナス値のセルだけ既存の赤系ステータス色(--status-serious)にする。月末現預金は
 *   表全体の最終到達点として、さらに太い罫線(--band-bg)とひとまわり大きい文字で
 *   最も目立たせる。
 */
export function MonthlyCashFlowScrollTable({ columns }: { columns: MonthColumn[] }) {
  const [referenceExpanded, setReferenceExpanded] = useState(false);

  return (
    <div className="flex flex-col gap-2">
      <SectionBanner>月次資金収支（会社版家計簿）</SectionBanner>

      <div className="overflow-x-auto">
        <div className="flex flex-col gap-3">
          <div className="rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)]">
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
                              (col.cashFlow.inflow?.unclassified ?? 0) !== 0 ||
                              (col.cashFlow.outflow?.unclassified ?? 0) !== 0
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
                <ValueRow row={OPENING_ROW} columns={columns} />
              </tbody>
            </table>
          </div>

          {SECTIONS.map((section) => (
            <SectionTile
              key={section.key}
              section={section}
              columns={columns}
              expanded={referenceExpanded}
              onToggle={() => setReferenceExpanded((v) => !v)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export { OPENING_ROW as __OPENING_ROW_FOR_TEST__, SECTIONS as __SECTIONS_FOR_TEST__ };
