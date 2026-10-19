"use client";

import { Fragment, useMemo, useState } from "react";
import { fiscalTermDateRange, fiscalYearToDateMonthsLabel } from "@/config/fiscalPeriods";
import { formatPercent, formatThousandYen, formatYen } from "@/utils/format";
import { FocusClientEditor } from "./FocusClientEditor";
import { computeFocusClients, dealStatus } from "./focusClients";
import type { DealStatus, FocusClientMaster, FocusClientRow, FocusClientSummary, FocusDeal } from "./focusClients";

const DASH = "―";

function rateText(rate: number | null): string {
  return rate === null ? DASH : formatPercent(rate);
}

/** 達成率100%未満は他タブと同じ色で示す */
function rateClassName(rate: number | null): string {
  if (rate === null) return "text-[var(--text-muted)]";
  return rate < 100 ? "text-[var(--status-serious)]" : "text-[var(--text-primary)]";
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

function SummarySection({ summary, toDate }: { summary: FocusClientSummary; toDate: string }) {
  return (
    <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <Tile
        label={`粗利達成率（${toDate}）`}
        value={rateText(summary.grossProfitRate)}
        valueClassName={rateClassName(summary.grossProfitRate)}
        sub={`目標粗利 ${formatYen(summary.targetGrossProfit)}（目標入力 ${summary.targetedCount}/${summary.clientCount}社）`}
      />
      <Tile
        label={`累計完了粗利（${toDate}・請求日基準）`}
        value={formatYen(summary.completedGrossProfitToDate)}
        sub={`通年完了予定 ${formatYen(summary.completedGrossProfitFullYear)}`}
      />
      <Tile
        label={`累計受注粗利（${toDate}・受注日基準、先行指標）`}
        value={formatYen(summary.orderGrossProfitToDate)}
      />
      <Tile
        label={`売上達成率（${toDate}）`}
        value={rateText(summary.salesRate)}
        valueClassName={rateClassName(summary.salesRate)}
        sub={`目標売上 ${formatYen(summary.targetSales)}／累計完了売上 ${formatYen(summary.completedSalesToDate)}`}
      />
      <Tile
        label="進行中（提案・見積）"
        value={`${summary.openCount}件`}
        sub={`見込み粗利 ${formatYen(summary.openGrossProfit)}`}
      />
      <Tile label="失注" value={`${summary.lostCount}件`} sub="集計からは除外、案件一覧には表示" />
    </section>
  );
}

type SortKey =
  | "name"
  | "category"
  | "owner"
  | "targetGrossProfit"
  | "completedGrossProfitToDate"
  | "grossProfitRate"
  | "targetSales"
  | "completedSalesToDate"
  | "salesRate"
  | "orderGrossProfitToDate"
  | "openGrossProfit"
  | "lostCount";

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
    case "targetSales":
      return row.target.sales || null;
    default:
      return row[key];
  }
}

/** 未入力(null)は昇順・降順どちらでも末尾 */
function compareRows(a: FocusClientRow, b: FocusClientRow, key: SortKey, desc: boolean): number {
  const va = sortValue(a, key);
  const vb = sortValue(b, key);
  if (va === null || va === "") return vb === null || vb === "" ? 0 : 1;
  if (vb === null || vb === "") return -1;
  const cmp = typeof va === "string" ? va.localeCompare(String(vb), "ja") : va - (vb as number);
  return desc ? -cmp : cmp;
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

const COLUMNS: { key: SortKey; label: (toDate: string) => string; numeric: boolean }[] = [
  { key: "name", label: () => "クライアント", numeric: false },
  { key: "category", label: () => "区分", numeric: false },
  { key: "owner", label: () => "社内担当", numeric: false },
  { key: "targetGrossProfit", label: () => "目標粗利", numeric: true },
  { key: "completedGrossProfitToDate", label: (t) => `完了粗利（${t}）`, numeric: true },
  { key: "grossProfitRate", label: () => "粗利達成率", numeric: true },
  { key: "targetSales", label: () => "目標売上", numeric: true },
  { key: "completedSalesToDate", label: (t) => `完了売上（${t}）`, numeric: true },
  { key: "salesRate", label: () => "売上達成率", numeric: true },
  { key: "orderGrossProfitToDate", label: (t) => `受注粗利（${t}）`, numeric: true },
  { key: "openGrossProfit", label: () => "進行中", numeric: true },
  { key: "lostCount", label: () => "失注", numeric: true },
];

interface FocusClientsViewProps {
  masters: FocusClientMaster[];
  deals: FocusDeal[];
  term: number;
  currentMonth: number;
  isCurrentTerm: boolean;
}

/**
 * 注力クライアント管理タブ本体。全体サマリー、絞り込み・並び替えできる一覧、
 * 会社名クリックで開く詳細(マスタ編集+案件一覧)からなる(ユーザー確定、2026-10-15)。
 */
export function FocusClientsView({ masters: initialMasters, deals, term, currentMonth, isCurrentTerm }: FocusClientsViewProps) {
  const [masters, setMasters] = useState(initialMasters);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "targetGrossProfit", desc: true });
  const [expanded, setExpanded] = useState<string | null>(null);

  const result = useMemo(
    () => computeFocusClients({ term, termRange: fiscalTermDateRange(term), currentMonth, masters, deals }),
    [term, currentMonth, masters, deals]
  );
  const categories = useMemo(
    () => [...new Set(masters.map((m) => m.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ja")),
    [masters]
  );
  const owners = useMemo(
    () => [...new Set(masters.map((m) => m.owner).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ja")),
    [masters]
  );

  const visibleRows = result.rows
    .filter((row) => !categoryFilter || row.master.category === categoryFilter)
    .filter((row) => !ownerFilter || row.master.owner === ownerFilter)
    .filter((row) => {
      const q = query.trim();
      return !q || row.master.name.includes(q) || row.master.theme.includes(q);
    })
    .sort((a, b) => compareRows(a, b, sort.key, sort.desc));
  const isFiltered = Boolean(categoryFilter || ownerFilter || query.trim());
  const visibleSummary = isFiltered
    ? computeFocusClients({
        term,
        termRange: fiscalTermDateRange(term),
        currentMonth,
        masters: visibleRows.map((r) => r.master),
        deals,
      }).summary
    : result.summary;
  const toDate = fiscalYearToDateMonthsLabel(currentMonth);

  function handleSort(key: SortKey) {
    setSort((prev) => (prev.key === key ? { key, desc: !prev.desc } : { key, desc: COLUMNS.find((c) => c.key === key)!.numeric }));
  }

  function handleSaved(saved: FocusClientMaster) {
    setMasters((prev) => prev.map((m) => (m.accountId === saved.accountId ? saved : m)));
  }

  if (masters.length === 0) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-24 text-center text-sm text-[var(--text-muted)]">
        注力クライアントマスタが未登録です。
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2 text-[var(--text-secondary)]">
          区分
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="rounded border border-[var(--border-hairline)] bg-[var(--surface-1)] px-2 py-1 text-[var(--text-primary)]"
          >
            <option value="">すべて</option>
            {categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-[var(--text-secondary)]">
          社内担当
          <select
            value={ownerFilter}
            onChange={(e) => setOwnerFilter(e.target.value)}
            className="rounded border border-[var(--border-hairline)] bg-[var(--surface-1)] px-2 py-1 text-[var(--text-primary)]"
          >
            <option value="">すべて</option>
            {owners.map((owner) => (
              <option key={owner} value={owner}>
                {owner}
              </option>
            ))}
          </select>
        </label>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="クライアント名・テーマで検索"
          className="w-full rounded border border-[var(--border-hairline)] bg-[var(--surface-1)] px-2 py-1 text-[var(--text-primary)] sm:w-64"
        />
        {isFiltered && (
          <span className="text-xs text-[var(--text-muted)]">
            {visibleRows.length}/{result.rows.length}社を表示（サマリーも絞り込み後の値）
          </span>
        )}
      </div>

      <SummarySection summary={visibleSummary} toDate={toDate} />

      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">注力クライアント一覧</h2>
          <span className="text-xs text-[var(--text-muted)]">
            単位: 千円／達成率 = 累計完了 ÷ 年間目標／目標未入力は「―」／列名クリックで並び替え、クライアント名クリックで詳細
          </span>
        </div>
        <div className="overflow-x-auto rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)]">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--gridline)] bg-[var(--surface-sunken)] text-xs font-medium whitespace-nowrap text-[var(--text-muted)]">
                {COLUMNS.map((col) => (
                  <th key={col.key} className={`px-3 py-2 ${col.numeric ? "text-right" : "text-left"}`}>
                    <button type="button" onClick={() => handleSort(col.key)} className="hover:text-[var(--text-primary)]">
                      {col.label(toDate)}
                      {sort.key === col.key && (sort.desc ? " ▼" : " ▲")}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => {
                const isOpen = expanded === row.master.accountId;
                return (
                  <Fragment key={row.master.accountId}>
                    <tr className={`border-t border-[var(--gridline)] tabular-nums ${isOpen ? "bg-[var(--surface-reference)]" : ""}`}>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => setExpanded(isOpen ? null : row.master.accountId)}
                          aria-expanded={isOpen}
                          className="text-left font-medium text-[var(--series-1)] hover:underline"
                        >
                          {row.master.name}
                        </button>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-[var(--text-secondary)]">{row.master.category || DASH}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-[var(--text-secondary)]">{row.master.owner || DASH}</td>
                      <td className="px-3 py-2 text-right">{targetText(row.target.grossProfit)}</td>
                      <td className="px-3 py-2 text-right">{formatThousandYen(row.completedGrossProfitToDate)}</td>
                      <td className={`px-3 py-2 text-right font-medium ${rateClassName(row.grossProfitRate)}`}>
                        {rateText(row.grossProfitRate)}
                      </td>
                      <td className="px-3 py-2 text-right">{targetText(row.target.sales)}</td>
                      <td className="px-3 py-2 text-right">{formatThousandYen(row.completedSalesToDate)}</td>
                      <td className={`px-3 py-2 text-right ${rateClassName(row.salesRate)}`}>{rateText(row.salesRate)}</td>
                      <td className="px-3 py-2 text-right">{formatThousandYen(row.orderGrossProfitToDate)}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap" title={`見込み売上 ${formatThousandYen(row.openSales)}千円`}>
                        {row.openCount > 0 ? `${row.openCount}件 ${formatThousandYen(row.openGrossProfit)}` : DASH}
                      </td>
                      <td className="px-3 py-2 text-right">{row.lostCount > 0 ? `${row.lostCount}件` : DASH}</td>
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
                                受注日・請求日・売上予定日のいずれかが当期内の案件
                                {isCurrentTerm && "と、日付によらず進行中（提案・見積）の案件"}
                                。完了・受注の実績は確度Aかつ受注以降のフェーズのみ集計しています。
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
          {visibleRows.length === 0 && (
            <p className="py-4 text-center text-sm text-[var(--text-muted)]">該当するクライアントはありません。</p>
          )}
        </div>
      </section>
    </div>
  );
}
