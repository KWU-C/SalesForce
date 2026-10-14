"use client";

import { useState } from "react";
import { CrTabs } from "@/components/CrTabs";
import { FISCAL_MONTH_ORDER, FISCAL_YEAR_END_MONTH, fiscalYearToDateMonthsLabel } from "@/config/fiscalPeriods";
import type { CrId } from "@/domain/types";
import { formatPercent, formatThousandYen, formatYen } from "@/utils/format";
import type { ClientProgressRow, ClientTargetScope, ClientTargetSummary, MonthlyClientTargetPoint } from "./clientTargets";
import { MonthlyClientTargetChart } from "./MonthlyClientTargetChart";

/** 集計期間の表記。toDate=期首〜当月(例: 9-10月)、fullYear=当期全月(9-8月) */
interface PeriodLabels {
  toDate: string;
  fullYear: string;
}

function rateText(rate: number | null): string {
  return rate === null ? "—" : formatPercent(rate);
}

/** 達成率100%未満は営業進捗タブのStatCardと同じ色で示す */
function rateClassName(rate: number | null): string {
  if (rate === null) return "text-[var(--text-muted)]";
  return rate < 100 ? "text-[var(--status-serious)]" : "text-[var(--text-primary)]";
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

function SummarySection({
  summary,
  currentMonth,
  periods,
}: {
  summary: ClientTargetSummary;
  currentMonth: number;
  periods: PeriodLabels;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Tile
          label="年間目標"
          value={formatYen(summary.annualTarget)}
          sub={`クライアント指定 ${formatYen(summary.clientTarget)}／未配分目標 ${formatYen(summary.unallocatedTarget)}`}
        />
        <Tile
          label={`累計完了粗利（${periods.toDate}・請求日基準）`}
          value={formatYen(summary.completedToDate)}
          sub={`うち目標未設定クライアント ${formatYen(summary.untargetedCompletedToDate)}`}
        />
        <Tile
          label="年間達成率"
          value={rateText(summary.annualRate)}
          valueClassName={rateClassName(summary.annualRate)}
          sub={`累計完了粗利（${periods.toDate}） ÷ 年間目標`}
        />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Tile
          label={`${currentMonth}月 完了粗利`}
          value={formatYen(summary.monthCompleted)}
          sub={`${currentMonth}月目標 ${formatYen(summary.monthTarget)}`}
        />
        <Tile
          label={`${currentMonth}月 月次達成率`}
          value={rateText(summary.monthRate)}
          valueClassName={rateClassName(summary.monthRate)}
          sub={`${currentMonth}月完了粗利 ÷ ${currentMonth}月目標`}
        />
        <Tile
          label={`通年完了予定粗利（${periods.fullYear}・請求予定を含む）`}
          value={formatYen(summary.completedFullYear)}
          sub={`うち目標未設定クライアント ${formatYen(summary.untargetedCompletedFullYear)}`}
        />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Tile
          label={`累計受注粗利（${periods.toDate}・受注日基準、先行指標）`}
          value={formatYen(summary.orderToDate)}
          sub={`うち目標未設定クライアント ${formatYen(summary.untargetedOrderToDate)}`}
        />
        <Tile
          label={`通年受注粗利（${periods.fullYear}・受注日基準）`}
          value={formatYen(summary.orderFullYear)}
          sub={`うち目標未設定クライアント ${formatYen(summary.untargetedOrderFullYear)}`}
        />
      </div>
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

/**
 * クライアント別進捗。列と並び(年間目標の降順)はユーザー確定(2026-10-14)。
 * 月次はこの表に限り受注基準(当月受注粗利 ÷ 当月目標)。上部タイルの月次達成率は完了基準のまま。
 */
function ClientTable({ rows, currentMonth, periods }: Omit<TableProps, "showCr">) {
  if (rows.length === 0) return <EmptyNote />;
  return (
    <TableShell>
      <thead>
        <HeadRow>
          <th className="px-3 py-2">CR</th>
          <th className="px-3 py-2">クライアント</th>
          <th className="px-3 py-2">担当者</th>
          <th className={TH}>年間目標</th>
          <th className={TH}>累計完了（{periods.toDate}）</th>
          <th className={TH}>年間達成率</th>
          <th className={TH}>{currentMonth}月受注目標</th>
          <th className={TH}>月次受注達成率</th>
        </HeadRow>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={`${row.crId}-${row.clientName ?? ""}`} className="border-t border-[var(--gridline)] tabular-nums">
            <td className="px-3 py-2 whitespace-nowrap text-[var(--text-secondary)]">{row.crId}</td>
            <td className="px-3 py-2 text-[var(--text-primary)]">{row.clientName}</td>
            <td className="px-3 py-2 whitespace-nowrap text-[var(--text-secondary)]">{row.salesRep ?? "—"}</td>
            <td className="px-3 py-2 text-right">{formatThousandYen(row.annualTarget)}</td>
            <td className="px-3 py-2 text-right">{formatThousandYen(row.completedToDate)}</td>
            <td className={`px-3 py-2 text-right font-medium ${rateClassName(row.annualRate)}`}>{rateText(row.annualRate)}</td>
            <td className="px-3 py-2 text-right">{formatThousandYen(row.monthTarget)}</td>
            <td
              className={`px-3 py-2 text-right ${rateClassName(row.monthOrderRate)}`}
              title={`${currentMonth}月受注粗利 ${formatThousandYen(row.monthOrder)}千円`}
            >
              {rateText(row.monthOrderRate)}
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

      <SummarySection summary={scope.summary} currentMonth={currentMonth} periods={periods} />

      <section className="flex flex-col gap-2">
        <SectionHeading
          title="クライアント別進捗"
          note={`単位: 千円／年間達成率 = 累計完了 ÷ 年間目標／月次受注達成率 = ${currentMonth}月受注粗利 ÷ ${currentMonth}月目標`}
        />
        <ClientTable rows={scope.targetedClients} currentMonth={currentMonth} periods={periods} />
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
