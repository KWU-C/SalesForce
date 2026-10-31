"use client";

import { useState } from "react";
import { CrTabs } from "@/components/CrTabs";
import { RateGauge } from "@/components/RateGauge";
import { FISCAL_MONTH_ORDER, FISCAL_YEAR_END_MONTH, fiscalYearToDateMonthsLabel } from "@/config/fiscalPeriods";
import type { CrId } from "@/domain/types";
import { formatPercent, formatThousandYen, formatYen } from "@/utils/format";
import { sortClientRows } from "./clientTargets";
import type {
  ClientProgressRow,
  ClientSortKey,
  ClientTargetScope,
  ClientTargetSummary,
  MonthlyClientTargetPoint,
  SortDirection,
} from "./clientTargets";
import { MonthlyClientTargetChart } from "./MonthlyClientTargetChart";

/** 集計期間の表記。toDate=期首〜当月(例: 9-10月)、fullYear=当期全月(9-8月) */
interface PeriodLabels {
  toDate: string;
  fullYear: string;
}

function rateText(rate: number | null): string {
  return rate === null ? "—" : formatPercent(rate);
}

/** 「達成率 00%」の右に小さいゲージを付ける(ユーザー指示、2026-10-31) */
function RateWithGauge({ prefix, rate, className = "" }: { prefix?: string; rate: number | null; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap ${className}`}>
      <span>
        {prefix}
        {rateText(rate)}
      </span>
      <RateGauge rate={rate} />
    </span>
  );
}

/** 達成率100%未満は営業進捗タブのStatCardと同じ色で示す */
function rateClassName(rate: number | null): string {
  if (rate === null) return "text-[var(--text-muted)]";
  return rate < 100 ? "text-[var(--status-serious)]" : "text-[var(--text-primary)]";
}

function Tile({
  label,
  value,
  sub,
  valueClassName,
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
  valueClassName?: string;
}) {
  return (
    <div className="rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)] p-4">
      <p className="text-sm text-[var(--text-secondary)]">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${valueClassName ?? "text-[var(--text-primary)]"}`}>{value}</p>
      {sub && <div className="mt-1 text-xs text-[var(--text-muted)]">{sub}</div>}
    </div>
  );
}

/** 全体に占める割合(%)。全体0ならnull */
function shareOf(part: number, total: number): number | null {
  return total === 0 ? null : Math.round((part / total) * 1000) / 10;
}

/** 実績 ÷ 目標(%)。目標0ならnull */
function rateOf(actual: number, target: number): number | null {
  return target === 0 ? null : Math.round((actual / target) * 1000) / 10;
}

/**
 * 上部タイル。1段目=年間目標、2段目=累計受注粗利、3段目=累計完了粗利を、それぞれ
 * 合計・内既存・内新規の3列で並べる(ユーザー確定、2026-10-31)。
 * 既存=クライアント指定の目標と、目標のあるクライアントの実績。
 * 新規=未配分目標(クライアント未指定の目標)と、目標未設定クライアントの実績。
 * 達成率はそれぞれの年間目標を分母にする。
 */
function SummarySection({ summary, periods }: { summary: ClientTargetSummary; periods: PeriodLabels }) {
  const existingTarget = summary.clientTarget;
  const newTarget = summary.unallocatedTarget;
  const actualRows = [
    {
      label: `累計受注粗利（${periods.toDate}・受注日基準）`,
      total: summary.orderToDate,
      newAmount: summary.untargetedOrderToDate,
    },
    {
      label: `累計完了粗利（${periods.toDate}・請求日基準）`,
      total: summary.completedToDate,
      newAmount: summary.untargetedCompletedToDate,
    },
  ];
  return (
    <section className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Tile label="年間目標" value={formatYen(summary.annualTarget)} />
        <Tile
          label={`内既存（${rateText(shareOf(existingTarget, summary.annualTarget))}）`}
          value={formatYen(existingTarget)}
          sub="クライアント指定の目標"
        />
        <Tile
          label={`内新規（${rateText(shareOf(newTarget, summary.annualTarget))}）`}
          value={formatYen(newTarget)}
          sub="未配分目標（クライアント未指定）"
        />
      </div>
      {actualRows.map(({ label, total, newAmount }) => {
        const existingAmount = total - newAmount;
        const totalRate = rateOf(total, summary.annualTarget);
        const existingRate = rateOf(existingAmount, existingTarget);
        const newRate = rateOf(newAmount, newTarget);
        return (
          <div key={label} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Tile label={label} value={formatYen(total)} sub={<RateWithGauge prefix="年間達成率 " rate={totalRate} />} />
            <Tile
              label="内既存"
              value={formatYen(existingAmount)}
              valueClassName={rateClassName(existingRate)}
              sub={<RateWithGauge prefix="達成率 " rate={existingRate} />}
            />
            <Tile
              label="内新規"
              value={formatYen(newAmount)}
              valueClassName={rateClassName(newRate)}
              sub={<RateWithGauge prefix="達成率 " rate={newRate} />}
            />
          </div>
        );
      })}
      {summary.crTargetGap !== null && Math.abs(summary.crTargetGap) >= 1 && (
        <p className="rounded border border-[var(--border-hairline)] bg-[var(--surface-reference)] px-3 py-2 text-xs text-[var(--text-secondary)]">
          営業進捗タブのCR年間目標 {formatYen(summary.crAnnualTarget ?? 0)} に対し、この画面の年間目標（Salesforceの目標レコード合計）は{" "}
          {formatYen(summary.annualTarget)} です（差額 {formatYen(summary.crTargetGap)}）。
          この画面の達成率はこの画面の年間目標を分母にしています。
        </p>
      )}
    </section>
  );
}

const TH = "px-3 py-2 text-right";

function TableShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)]">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  );
}

function HeadRow({ children }: { children: React.ReactNode }) {
  return (
    <tr className="border-b border-[var(--gridline)] bg-[var(--surface-sunken)] text-left text-xs font-medium whitespace-nowrap text-[var(--text-muted)]">
      {children}
    </tr>
  );
}

function EmptyNote() {
  return <p className="py-4 text-center text-sm text-[var(--text-muted)]">該当するクライアントはありません。</p>;
}

interface TableProps {
  rows: ClientProgressRow[];
  showCr: boolean;
  currentMonth: number;
  periods: PeriodLabels;
}

interface ClientSort {
  key: ClientSortKey;
  direction: SortDirection;
}

/** 初期表示は年間目標の高い順(ユーザー確定、2026-10-14・2026-10-31) */
const DEFAULT_CLIENT_SORT: ClientSort = { key: "annualTarget", direction: "desc" };

/** 文字列の列は昇順、数値の列は降順から始める */
const TEXT_SORT_KEYS: readonly ClientSortKey[] = ["crId", "clientName", "inCharge"];

function SortableTh({
  label,
  sortKey,
  sort,
  onSort,
  align = "left",
}: {
  label: string;
  sortKey: ClientSortKey;
  sort: ClientSort;
  onSort: (key: ClientSortKey) => void;
  align?: "left" | "right";
}) {
  const active = sort.key === sortKey;
  return (
    <th
      className={`px-3 py-2 ${align === "right" ? "text-right" : ""}`}
      aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 hover:text-[var(--text-primary)] ${active ? "text-[var(--text-primary)]" : ""}`}
      >
        {label}
        <span aria-hidden className={active ? "" : "opacity-30"}>
          {active && sort.direction === "asc" ? "▲" : "▼"}
        </span>
      </button>
    </th>
  );
}

/**
 * クライアント別進捗。列はユーザー確定(2026-10-14)。各列の見出しクリックで並べ替え、
 * 同じ列をもう一度押すと昇順・降順が切り替わる(初期は年間目標の降順、2026-10-31)。
 * 月次はこの表に限り受注基準(当月受注粗利 ÷ 当月目標)。
 */
function ClientTable({
  rows,
  inChargeAvailable,
  currentMonth,
  periods,
}: Omit<TableProps, "showCr"> & { inChargeAvailable: boolean }) {
  const [sort, setSort] = useState<ClientSort>(DEFAULT_CLIENT_SORT);
  if (rows.length === 0) return <EmptyNote />;
  const onSort = (key: ClientSortKey) =>
    setSort((prev) =>
      prev.key === key
        ? { key, direction: prev.direction === "asc" ? "desc" : "asc" }
        : { key, direction: TEXT_SORT_KEYS.includes(key) ? "asc" : "desc" }
    );
  const sorted = sortClientRows(rows, sort.key, sort.direction);
  const th = { sort, onSort };
  return (
    <TableShell>
      <thead>
        <HeadRow>
          <SortableTh label="CR" sortKey="crId" {...th} />
          <SortableTh label="クライアント" sortKey="clientName" {...th} />
          <SortableTh label="担当者" sortKey="inCharge" {...th} />
          <SortableTh label="年間目標" sortKey="annualTarget" align="right" {...th} />
          <SortableTh label={`累計完了（${periods.toDate}）`} sortKey="completedToDate" align="right" {...th} />
          <SortableTh label="年間達成率" sortKey="annualRate" align="right" {...th} />
          <SortableTh label={`${currentMonth}月受注目標`} sortKey="monthTarget" align="right" {...th} />
          <SortableTh label="月次受注達成率" sortKey="monthOrderRate" align="right" {...th} />
        </HeadRow>
      </thead>
      <tbody>
        {sorted.map((row) => (
          <tr key={`${row.crId}-${row.clientName ?? ""}`} className="border-t border-[var(--gridline)] tabular-nums">
            <td className="px-3 py-2 whitespace-nowrap text-[var(--text-secondary)]">{row.crId}</td>
            <td className="px-3 py-2 text-[var(--text-primary)]">{row.clientName}</td>
            <td className="px-3 py-2 whitespace-nowrap text-[var(--text-secondary)]">{inChargeAvailable ? (row.inCharge ?? "（未設定）") : "—"}</td>
            <td className="px-3 py-2 text-right">{formatThousandYen(row.annualTarget)}</td>
            <td className="px-3 py-2 text-right">{formatThousandYen(row.completedToDate)}</td>
            <td className={`px-3 py-2 text-right font-medium ${rateClassName(row.annualRate)}`}>
              <RateWithGauge rate={row.annualRate} />
            </td>
            <td className="px-3 py-2 text-right">{formatThousandYen(row.monthTarget)}</td>
            <td
              className={`px-3 py-2 text-right ${rateClassName(row.monthOrderRate)}`}
              title={`${currentMonth}月受注粗利 ${formatThousandYen(row.monthOrder)}千円`}
            >
              <RateWithGauge rate={row.monthOrderRate} />
            </td>
          </tr>
        ))}
      </tbody>
    </TableShell>
  );
}

/** 未配分目標(クライアント未指定の目標)。実績は紐づかないため目標額のみ */
function UnallocatedTargetTable({ rows, currentMonth }: { rows: ClientProgressRow[]; currentMonth: number }) {
  return (
    <TableShell>
      <thead>
        <HeadRow>
          <th className="px-3 py-2">CR</th>
          <th className={TH}>年間目標</th>
          <th className={TH}>{currentMonth}月目標</th>
        </HeadRow>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.crId} className="border-t border-[var(--gridline)] tabular-nums">
            <td className="px-3 py-2 text-[var(--text-secondary)]">{row.crId}</td>
            <td className="px-3 py-2 text-right">{formatThousandYen(row.annualTarget)}</td>
            <td className="px-3 py-2 text-right">{formatThousandYen(row.monthTarget)}</td>
          </tr>
        ))}
      </tbody>
    </TableShell>
  );
}

/** 目標未設定クライアントの実績。目標・達成率の列は常に空になるため持たない */
function UntargetedClientTable({ rows, showCr, currentMonth, periods }: TableProps) {
  if (rows.length === 0) return <EmptyNote />;
  return (
    <TableShell>
      <thead>
        <HeadRow>
          {showCr && <th className="px-3 py-2">CR</th>}
          <th className="px-3 py-2">クライアント</th>
          <th className={TH}>累計完了（{periods.toDate}）</th>
          <th className={TH}>通年完了予定</th>
          <th className={TH}>{currentMonth}月完了</th>
          <th className={TH}>累計受注（{periods.toDate}）</th>
          <th className={TH}>通年受注</th>
        </HeadRow>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={`${row.crId}-${row.clientName ?? ""}`} className="border-t border-[var(--gridline)] tabular-nums">
            {showCr && <td className="px-3 py-2 whitespace-nowrap text-[var(--text-secondary)]">{row.crId}</td>}
            <td className="px-3 py-2 text-[var(--text-primary)]">
              {row.clientName ?? <span className="text-[var(--text-muted)]">（クライアント名なし）</span>}
            </td>
            <td className="px-3 py-2 text-right">{formatThousandYen(row.completedToDate)}</td>
            <td className="px-3 py-2 text-right text-[var(--text-secondary)]">{formatThousandYen(row.completedFullYear)}</td>
            <td className="px-3 py-2 text-right">{formatThousandYen(row.monthCompleted)}</td>
            <td className="px-3 py-2 text-right">{formatThousandYen(row.orderToDate)}</td>
            <td className="px-3 py-2 text-right text-[var(--text-secondary)]">{formatThousandYen(row.orderFullYear)}</td>
          </tr>
        ))}
      </tbody>
    </TableShell>
  );
}

function MonthlyTable({ monthly }: { monthly: MonthlyClientTargetPoint[] }) {
  return (
    <TableShell>
      <thead>
        <HeadRow>
          <th className="px-3 py-2">月</th>
          <th className={TH}>月次目標</th>
          <th className={TH}>完了粗利</th>
          <th className={TH}>月次達成率</th>
          <th className={TH}>累計目標</th>
          <th className={TH}>累計完了</th>
          <th className={TH}>受注粗利</th>
        </HeadRow>
      </thead>
      <tbody>
        {monthly.map((m) => {
          // 当月より先の月は請求予定のみのため、達成率は出さない(0%の赤字表示で誤解させない)
          const monthRate = m.isFuture || m.target === 0 ? null : Math.round((m.completed / m.target) * 1000) / 10;
          return (
            <tr
              key={m.month}
              className={`border-t border-[var(--gridline)] tabular-nums ${m.isFuture ? "text-[var(--text-muted)]" : ""}`}
            >
              <td className="px-3 py-2 whitespace-nowrap text-[var(--text-secondary)]">
                {m.month}月{m.isFuture && "（予定）"}
              </td>
              <td className="px-3 py-2 text-right">{formatThousandYen(m.target)}</td>
              <td className="px-3 py-2 text-right">{formatThousandYen(m.completed)}</td>
              <td className={`px-3 py-2 text-right ${rateClassName(monthRate)}`}>{rateText(monthRate)}</td>
              <td className="px-3 py-2 text-right">{formatThousandYen(m.cumulativeTarget)}</td>
              <td className="px-3 py-2 text-right">{formatThousandYen(m.cumulativeCompleted)}</td>
              <td className="px-3 py-2 text-right">{formatThousandYen(m.order)}</td>
            </tr>
          );
        })}
      </tbody>
    </TableShell>
  );
}

function SectionHeading({ title, note }: { title: string; note?: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="text-base font-semibold text-[var(--text-primary)]">{title}</h2>
      {note && <span className="text-xs text-[var(--text-muted)]">{note}</span>}
    </div>
  );
}

interface ClientTargetsViewProps {
  scopes: ClientTargetScope[];
  crList: { id: CrId; label: string }[];
  currentMonth: number;
}

/**
 * クライアント別目標タブ本体。上部に年間目標・累計完了粗利・達成率、その下に
 * クライアント別一覧(目標あり/未配分目標/目標未設定の実績)と月次推移を並べる
 * (ユーザー確定、2026-10-14)。累計は期首〜当月、通年は当月より先の予定分を含む。
 */
export function ClientTargetsView({ scopes, crList, currentMonth }: ClientTargetsViewProps) {
  const [selected, setSelected] = useState<CrId>("ALL");
  const scope = scopes.find((s) => s.scopeId === selected) ?? scopes[0];
  const showCr = scope.scopeId === "ALL";
  const periods: PeriodLabels = {
    toDate: fiscalYearToDateMonthsLabel(currentMonth),
    fullYear: `${FISCAL_MONTH_ORDER[0]}-${FISCAL_YEAR_END_MONTH}月`,
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6">
      <CrTabs crList={crList} selected={selected} onSelect={setSelected} />

      <SummarySection summary={scope.summary} periods={periods} />

      <section className="flex flex-col gap-2">
        <SectionHeading
          title="クライアント別進捗"
          note={`単位: 千円／年間達成率 = 累計完了 ÷ 年間目標／月次受注達成率 = ${currentMonth}月受注粗利 ÷ ${currentMonth}月目標`}
        />
        <ClientTable
          rows={scope.targetedClients}
          inChargeAvailable={scope.inChargeAvailable}
          currentMonth={currentMonth}
          periods={periods}
        />
      </section>

      {scope.unallocatedTargets.length > 0 && (
        <section className="flex flex-col gap-2">
          <SectionHeading title="未配分目標（クライアント未指定）" note="単位: 千円" />
          <p className="text-xs text-[var(--text-muted)]">
            クライアントを指定せずに登録された目標です。年間目標には含めていますが、特定のクライアントの実績には紐づけていません。
          </p>
          <UnallocatedTargetTable rows={scope.unallocatedTargets} currentMonth={currentMonth} />
        </section>
      )}

      <section className="flex flex-col gap-2">
        <SectionHeading title={`目標未設定クライアントの実績（${scope.untargetedClients.length}社）`} note="単位: 千円" />
        <p className="text-xs text-[var(--text-muted)]">
          同じCRにクライアント別目標が登録されていないクライアントの実績です。親会社・子会社などで目標と案件のクライアント名が異なる場合もここに表示されます。
        </p>
        <UntargetedClientTable rows={scope.untargetedClients} showCr={showCr} currentMonth={currentMonth} periods={periods} />
      </section>

      <section className="flex flex-col gap-3">
        <SectionHeading title="月次推移" note="単位: 千円／当月より先の月は請求・受注の予定分" />
        <MonthlyClientTargetChart monthly={scope.monthly} />
        <MonthlyTable monthly={scope.monthly} />
      </section>
    </div>
  );
}
