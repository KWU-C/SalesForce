"use client";

import { Fragment, useMemo, useState } from "react";
import { CrTabs } from "@/components/CrTabs";
import { RATE_BAR_TRACK_COLOR, rateBarFillColor } from "@/components/rateBarColors";
import type { CrId } from "@/domain/types";
import { fiscalTermDateRange } from "@/config/fiscalPeriods";
import { formatPercent, formatThousandYen, formatYen } from "@/utils/format";
import { FocusClientEditor } from "./FocusClientEditor";
import { FocusClientMemoEditor } from "./FocusClientMemoEditor";
import { applySavedFields, categoryGroup, computeFocusClients, dealStatus } from "./focusClients";
import type {
  DealStatus,
  FocusClientMaster,
  FocusClientRow,
  FocusClientSavedFields,
  FocusClientSummary,
  FocusDeal,
  ScopeTargets,
} from "./focusClients";

const DASH = "―";

function rateText(rate: number | null): string {
  return rate === null ? DASH : formatPercent(rate);
}

/** 達成率100%未満は他タブと同じ色で示す */
function rateClassName(rate: number | null): string {
  if (rate === null) return "text-[var(--text-muted)]";
  return rate < 100 ? "text-[var(--status-serious)]" : "text-[var(--text-primary)]";
}

/** 一覧の達成率の文字は、バーがオレンジ(50%以上80%未満)のときだけバーと同じオレンジにする(ユーザー指示、2026-10-24) */
function rowRateTextStyle(rate: number | null): { color: string } | undefined {
  return rate !== null && rate >= 50 && rate < 80 ? { color: rateBarFillColor(rate) } : undefined;
}

/** 目標が未入力・0円のときは「―」(ユーザー指定) */
function targetText(amount: number | null): string {
  return amount ? formatThousandYen(amount) : DASH;
}

function Tile({ label, value, sub, valueClassName }: { label: string; value: string; sub?: string; valueClassName?: string }) {
  return (
    <div className="rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)] p-4">
      <p className="text-sm text-[var(--text-secondary)]">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${valueClassName ?? "text-[var(--text-primary)]"}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-[var(--text-muted)]">{sub}</p>}
    </div>
  );
}

/** 上部のサマリー。完了粗利・目標粗利・達成率の合算3つ(ユーザー指示、2026-10-19) */
/** 目標粗利の下は全社目標(CRタブではそのCRの目標)と、そのうち注力クライアントの目標粗利が占める割合を出す(ユーザー指示、2026-10-19) */
function SummarySection({
  summary,
  scopeLabel,
  scopeTarget,
}: {
  summary: FocusClientSummary;
  scopeLabel: string;
  scopeTarget: number | null;
}) {
  return (
    <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <Tile label="完了粗利" value={formatYen(summary.completedGrossProfitFullYear)} sub="通年（当期の請求予定を含む）" />
      <Tile
        label="目標粗利"
        value={formatYen(summary.targetGrossProfit)}
        sub={
          scopeTarget
            ? `${scopeLabel}目標 ${formatYen(scopeTarget)} の内${formatPercent((summary.targetGrossProfit / scopeTarget) * 100)}`
            : `${scopeLabel}目標 ${DASH}`
        }
      />
      <Tile
        label="達成率"
        value={rateText(summary.grossProfitRateFullYear)}
        valueClassName={rateClassName(summary.grossProfitRateFullYear)}
        sub="目標入力済みの社の完了粗利 ÷ 目標粗利"
      />
    </section>
  );
}

type SortKey = "category" | "name" | "owner" | "targetGrossProfit" | "completedGrossProfitFullYear" | "grossProfitRateFullYear" | "dealCount";

function sortValue(row: FocusClientRow, key: SortKey): string | number | null {
  switch (key) {
    case "name":
      return row.master.name;
    case "category":
      return row.master.category;
    case "owner":
      return row.master.owner;
    case "targetGrossProfit":
      return row.target.grossProfit || null;
    case "dealCount":
      return row.deals.length;
    default:
      return row[key];
  }
}

/** 区分グループ(注力→掘り起こし)が常に優先。未入力(null)は昇順・降順どちらでもグループ内の末尾 */
function compareRows(a: FocusClientRow, b: FocusClientRow, key: SortKey, desc: boolean): number {
  const byGroup = categoryGroup(a.master.category) - categoryGroup(b.master.category);
  if (byGroup !== 0) return byGroup;
  const va = sortValue(a, key);
  const vb = sortValue(b, key);
  if (va === null || va === "") return vb === null || vb === "" ? 0 : 1;
  if (vb === null || vb === "") return -1;
  const cmp = typeof va === "string" ? va.localeCompare(String(vb), "ja") : va - (vb as number);
  return desc ? -cmp : cmp;
}

/** 達成率バー(幅80px)。100%以上は満タン。塗りの色はrateBarFillColor(80%以上 青・50%以上 オレンジ・50%未満 赤) */
function RateBar({ rate }: { rate: number | null }) {
  if (rate === null) return null;
  return (
    <div className="h-2 w-20 overflow-hidden rounded-sm" style={{ backgroundColor: RATE_BAR_TRACK_COLOR }} aria-hidden>
      <div
        className="h-full"
        style={{ width: `${Math.min(Math.max(rate, 0), 100)}%`, backgroundColor: rateBarFillColor(rate) }}
      />
    </div>
  );
}

const STATUS_LABEL: Record<DealStatus, string> = { open: "進行中", won: "受注以降", lost: "失注" };

function dateText(date: string | null): string {
  return date ? date.replaceAll("-", "/") : "";
}

function DealsTable({ deals }: { deals: FocusDeal[] }) {
  if (deals.length === 0) {
    return <p className="py-2 text-sm text-[var(--text-muted)]">この期の案件はありません。</p>;
  }
  return (
    <div className="max-h-96 overflow-auto rounded border border-[var(--border-hairline)]">
      <table className="w-full border-collapse text-xs">
        <thead className="sticky top-0 bg-[var(--surface-sunken)]">
          <tr className="text-left whitespace-nowrap text-[var(--text-muted)]">
            <th className="px-2 py-1.5">状態</th>
            <th className="px-2 py-1.5">案件名</th>
            <th className="px-2 py-1.5">CR</th>
            <th className="px-2 py-1.5">営業担当</th>
            <th className="px-2 py-1.5">フェーズ</th>
            <th className="px-2 py-1.5">確度</th>
            <th className="px-2 py-1.5 text-right">売上</th>
            <th className="px-2 py-1.5 text-right">粗利</th>
            <th className="px-2 py-1.5">受注日</th>
            <th className="px-2 py-1.5">請求日</th>
            <th className="px-2 py-1.5">売上予定日</th>
            <th className="px-2 py-1.5">失注理由</th>
          </tr>
        </thead>
        <tbody>
          {deals.map((deal) => {
            const status = dealStatus(deal);
            return (
              <tr
                key={deal.id}
                className={`border-t border-[var(--gridline)] align-top tabular-nums ${status === "lost" ? "text-[var(--text-muted)]" : ""}`}
              >
                <td className="px-2 py-1.5 whitespace-nowrap">{STATUS_LABEL[status]}</td>
                <td className="min-w-48 px-2 py-1.5 text-[var(--text-primary)]">{deal.name}</td>
                <td className="px-2 py-1.5 whitespace-nowrap">{deal.crId ?? ""}</td>
                <td className="px-2 py-1.5 whitespace-nowrap">{deal.salesRep ?? ""}</td>
                <td className="px-2 py-1.5 whitespace-nowrap">{deal.phase ?? ""}</td>
                <td className="px-2 py-1.5 whitespace-nowrap">{deal.confidence?.charAt(0) ?? ""}</td>
                <td className="px-2 py-1.5 text-right">{deal.sales === null ? "" : formatThousandYen(deal.sales)}</td>
                <td className="px-2 py-1.5 text-right">
                  {deal.grossProfit === null ? "" : formatThousandYen(deal.grossProfit)}
                </td>
                <td className="px-2 py-1.5 whitespace-nowrap">{dateText(deal.orderDate)}</td>
                <td className="px-2 py-1.5 whitespace-nowrap">{dateText(deal.invoiceDate)}</td>
                <td className="px-2 py-1.5 whitespace-nowrap">{dateText(deal.plannedSalesDate)}</td>
                <td className="min-w-40 px-2 py-1.5 whitespace-pre-wrap">{deal.lostReason ?? ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * 一覧の列(ユーザー指示、2026-10-19)。keyの無い列(達成率バー)は並び替えなし。
 * 表の余りは担当列が受け持つ(クライアント列は全角12文字幅に固定)。注力・掘り起こしを別の表にしても
 * 上下で列がそろうよう、担当・クライアント以外は幅を決めている(2026-10-22)
 */
const COLUMNS: { key: SortKey | null; label: string; numeric: boolean; width?: string }[] = [
  { key: "category", label: "区分", numeric: false, width: "100px" },
  { key: "name", label: "クライアント", numeric: false },
  { key: "owner", label: "担当", numeric: false },
  { key: "targetGrossProfit", label: "目標粗利", numeric: true, width: "104px" },
  { key: "completedGrossProfitFullYear", label: "完了粗利", numeric: true, width: "104px" },
  { key: "grossProfitRateFullYear", label: "達成率", numeric: true, width: "84px" },
  { key: null, label: "", numeric: false, width: "104px" },
  { key: "dealCount", label: "案件数", numeric: true, width: "180px" },
];
/** メモ行が担当〜案件数の下に入るため、区分・クライアントの2列は2行にまたがる */
const MEMO_COL_SPAN = COLUMNS.length - 2;

/** 区分グループ(注力→掘り起こし→その他)ごとに分ける。空のグループは返さない */
function groupRows(rows: FocusClientRow[]): FocusClientRow[][] {
  const groups = new Map<number, FocusClientRow[]>();
  for (const row of rows) {
    const g = categoryGroup(row.master.category);
    groups.set(g, [...(groups.get(g) ?? []), row]);
  }
  return [...groups.entries()].sort(([a], [b]) => a - b).map(([, g]) => g);
}

interface FocusClientTableProps {
  rows: FocusClientRow[];
  term: number;
  expanded: string | null;
  onToggle: (accountId: string) => void;
  onSaved: (saved: FocusClientSavedFields) => void;
}

/** 区分1つ分の一覧表。並び替えは表ごとに持つ(ユーザー指示、2026-10-22) */
function FocusClientTable({ rows, term, expanded, onToggle, onSaved: handleSaved }: FocusClientTableProps) {
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "targetGrossProfit", desc: true });
  const sortedRows = [...rows].sort((a, b) => compareRows(a, b, sort.key, sort.desc));

  function handleSort(key: SortKey) {
    setSort((prev) => (prev.key === key ? { key, desc: !prev.desc } : { key, desc: COLUMNS.find((c) => c.key === key)!.numeric }));
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)]">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-[var(--gridline)] bg-[var(--surface-sunken)] text-xs font-medium whitespace-nowrap text-[var(--text-muted)]">
            {COLUMNS.map((col, i) => (
              <th
                key={col.key ?? `col-${i}`}
                style={col.width ? { width: col.width } : undefined}
                className={`px-3 py-2 ${col.numeric ? "text-right" : "text-left"} ${col.width || col.key === "owner" ? "" : "w-px"}`}
              >
                {col.key && (
                  <button type="button" onClick={() => handleSort(col.key!)} className="hover:text-[var(--text-primary)]">
                    {col.label}
                    {sort.key === col.key && (sort.desc ? " ▼" : " ▲")}
                  </button>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row) => {
            const isOpen = expanded === row.master.accountId;
            const rowBg = isOpen ? "bg-[var(--surface-reference)]" : "";
            return (
              <Fragment key={row.master.accountId}>
                <tr className={`tabular-nums ${rowBg} border-t border-[var(--gridline)]`}>
                  <td rowSpan={2} className="px-3 py-2 align-top whitespace-nowrap text-[var(--text-secondary)]">
                    {row.master.category || DASH}
                  </td>
                  <td rowSpan={2} className="px-3 py-2 align-top">
                    {/* 全角12文字が改行なしで入る幅(ユーザー指示、2026-10-19) */}
                    <button
                      type="button"
                      onClick={() => onToggle(row.master.accountId)}
                      aria-expanded={isOpen}
                      className="block w-[12em] text-left font-medium text-[var(--series-1)] hover:underline"
                    >
                      {row.master.name}
                    </button>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-[var(--text-secondary)]">{row.master.owner || DASH}</td>
                  <td className="px-3 py-2 text-right">{targetText(row.target.grossProfit)}</td>
                  <td className="px-3 py-2 text-right">{formatThousandYen(row.completedGrossProfitFullYear)}</td>
                  <td
                    className={`px-3 py-2 text-right font-medium ${rateClassName(row.grossProfitRateFullYear)}`}
                    style={rowRateTextStyle(row.grossProfitRateFullYear)}
                  >
                    {rateText(row.grossProfitRateFullYear)}
                  </td>
                  <td className="px-3 py-2">
                    <RateBar rate={row.grossProfitRateFullYear} />
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {row.deals.length > 0 ? (
                      <>
                        {row.deals.length}件
                        <span className="block text-xs text-[var(--text-muted)]">
                          進行中{row.openCount}・受注{row.deals.length - row.openCount - row.lostCount}・失注{row.lostCount}
                        </span>
                      </>
                    ) : (
                      DASH
                    )}
                  </td>
                </tr>
                <tr className={rowBg}>
                  <td colSpan={MEMO_COL_SPAN} className="px-3 pb-2">
                    <FocusClientMemoEditor key={row.master.accountId} master={row.master} onSaved={handleSaved} />
                  </td>
                </tr>
                {isOpen && (
                  <tr className="border-t border-[var(--gridline)] bg-[var(--surface-reference)]">
                    <td colSpan={COLUMNS.length} className="px-3 py-4">
                      <div className="flex flex-col gap-4">
                        <FocusClientEditor
                          key={row.master.accountId}
                          master={row.master}
                          term={term}
                          onSaved={handleSaved}
                        />
                        <div className="flex flex-col gap-1">
                          <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                            第{term}期の案件（{row.deals.length}件、単位: 千円）
                          </h3>
                          <p className="text-xs text-[var(--text-muted)]">
                            受注日・請求日・売上予定日のいずれかが当期内の案件（日付が未入力なら当期内に作成された案件）。完了・受注の実績は確度Aかつ受注以降のフェーズのみ集計しています。
                          </p>
                          <DealsTable deals={row.deals} />
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

interface FocusClientsViewProps {
  masters: FocusClientMaster[];
  deals: FocusDeal[];
  term: number;
  currentMonth: number;
  crList: { id: CrId; label: string }[];
  scopeTargets: ScopeTargets;
}

/**
 * 注力クライアント管理タブ本体。CRタブ、全体サマリー、絞り込み・並び替えできる一覧、
 * 会社名クリックで開く詳細(マスタ編集+案件一覧)からなる(ユーザー確定、2026-10-15)。
 * 絞り込み・検索欄は廃止し、一覧は区分→クライアント→担当→粗利の列と行内メモにした(ユーザー指示、2026-10-19)。
 * CRタブは社内担当(Salesforce取引先の社内担当者)の部署で振り分ける(ユーザー指示、2026-10-19)。
 * 目標・実績は会社単位のままで、他CRの案件も含む。部署がCR1〜4でない・担当なしの社は全社タブにだけ出る。
 */
export function FocusClientsView({
  masters: initialMasters,
  deals,
  term,
  currentMonth,
  crList,
  scopeTargets,
}: FocusClientsViewProps) {
  const [masters, setMasters] = useState(initialMasters);
  const [selectedCr, setSelectedCr] = useState<CrId>("ALL");
  const [expanded, setExpanded] = useState<string | null>(null);

  const result = useMemo(
    () => computeFocusClients({ term, termRange: fiscalTermDateRange(term), currentMonth, masters, deals }),
    [term, currentMonth, masters, deals]
  );

  const unassignedCount = result.rows.filter((row) => row.master.crId === null).length;
  const visibleRows = result.rows.filter((row) => selectedCr === "ALL" || row.master.crId === selectedCr);
  const visibleSummary =
    selectedCr !== "ALL"
      ? computeFocusClients({
          term,
          termRange: fiscalTermDateRange(term),
          currentMonth,
          masters: visibleRows.map((r) => r.master),
          deals,
        }).summary
      : result.summary;

  function handleSaved(saved: FocusClientSavedFields) {
    setMasters((prev) => prev.map((m) => (m.accountId === saved.accountId ? applySavedFields(m, saved) : m)));
  }

  if (masters.length === 0) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-24 text-center text-sm text-[var(--text-muted)]">
        Salesforceの取引先に、ターゲット区分が注力・掘り起こしの会社がありません。
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6">
      <div className="flex flex-col gap-1">
        <CrTabs crList={crList} selected={selectedCr} onSelect={setSelectedCr} />
        <p className="text-xs text-[var(--text-muted)]">
          一覧・区分・担当・目標はSalesforceの取引先（ターゲット区分が注力・掘り起こし）を毎回読み込んでいます。CRは担当の所属CR（Salesforceのユーザーの部署）で振り分けています。目標・実績は会社単位で、他CRの案件も含みます。
          {unassignedCount > 0 && `担当が未設定か、担当の部署がCR1〜4でない${unassignedCount}社は全社タブにだけ表示しています。`}
        </p>
      </div>

      <SummarySection
        summary={visibleSummary}
        scopeLabel={selectedCr === "ALL" ? "全社" : selectedCr}
        scopeTarget={scopeTargets[selectedCr]}
      />

      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">注力クライアント一覧</h2>
          <span className="text-xs text-[var(--text-muted)]">
            単位: 千円／完了粗利は通年（当期の請求予定を含む）／達成率 = 完了粗利 ÷ 目標粗利／案件数は詳細に出る当期の案件の件数（内訳: 進行中＝提案・見積、受注＝受注以降、失注）／目標未入力は「―」／列名クリックで並び替え（表ごと）、クライアント名クリックで詳細
          </span>
        </div>
        {/* 注力と掘り起こしは別の表にし、間を30px空ける。並び替えは表ごと(ユーザー指示、2026-10-22) */}
        {visibleRows.length === 0 ? (
          <p className="rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)] py-4 text-center text-sm text-[var(--text-muted)]">
            該当するクライアントはありません。
          </p>
        ) : (
          <div className="flex flex-col gap-[30px]">
            {groupRows(visibleRows).map((rows) => (
              <FocusClientTable
                key={categoryGroup(rows[0].master.category)}
                rows={rows}
                term={term}
                expanded={expanded}
                onToggle={(accountId) => setExpanded((prev) => (prev === accountId ? null : accountId))}
                onSaved={handleSaved}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
