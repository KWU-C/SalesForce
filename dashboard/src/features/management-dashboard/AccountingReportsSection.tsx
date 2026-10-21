"use client";

import { Fragment, useState } from "react";
import { formatDateTime, formatYen } from "@/utils/format";
import { SectionBanner } from "./SectionBanner";
import { AccountingReportForm } from "./AccountingReportForm";
import {
  CHANGE_TYPE_LABELS,
  actualKindsDifference,
  checkCashPlan,
  compareCashPlan,
  difference,
  targetMonthLabel,
} from "./accountingReports";
import type { CashPlanActual, CashPlanValues, MonthlyReportValues, Revision } from "./accountingReports";
import type { AccountingReportsView, CashPlanWithActual } from "./accountingReportsService";

/** 資金繰り予定の初期表示件数(直近6か月、ユーザー確定 2026-10-15) */
const INITIAL_CASH_PLAN_COUNT = 6;

const TH = "px-3 py-2 text-right font-medium";
const TD = "px-3 py-2 text-right tabular-nums whitespace-nowrap";

function amount(value: number | null | undefined): string {
  return value === null || value === undefined ? "―" : formatYen(value);
}

function date(value: string | null): string {
  return value ? value.replaceAll("-", "/") : "記載なし";
}

function dateTime(iso: string): string {
  return formatDateTime(new Date(iso));
}

function DiffCell({ value }: { value: number | null }) {
  if (value === null) return <td className={`${TD} text-[var(--text-muted)]`}>比較不可</td>;
  return (
    <td className={`${TD} ${value === 0 ? "text-[var(--text-muted)]" : "font-medium text-[var(--status-serious)]"}`}>
      {value > 0 ? "+" : ""}
      {formatYen(value)}
    </td>
  );
}

function TableShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)]">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  );
}

function HeadRow({ children }: { children: React.ReactNode }) {
  return (
    <tr className="border-b border-[var(--gridline)] bg-[var(--surface-sunken)] text-xs whitespace-nowrap text-[var(--text-muted)]">
      {children}
    </tr>
  );
}

function RevisionList<V>({ revisions, describe }: { revisions: Revision<V>[]; describe: (values: V) => string }) {
  return (
    <ul className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
      {[...revisions].reverse().map((r, i) => (
        <li key={i}>
          {dateTime(r.changedAt)} {CHANGE_TYPE_LABELS[r.changeType]}（{r.changedBy}）／変更前: {describe(r.values)}
          （{r.previousUpdatedBy}、{dateTime(r.previousUpdatedAt)}登録）
        </li>
      ))}
    </ul>
  );
}

function describeMonthlyReport(v: MonthlyReportValues): string {
  return `売上高累計 ${amount(v.revenueCumulative)}・経常利益累計 ${amount(v.ordinaryProfitCumulative)}・集計基準日 ${date(v.basisDate)}・報告日 ${date(v.reportDate)}・${v.documentName}`;
}

function describeCashPlan(v: CashPlanValues): string {
  return `当座・普通 ${amount(v.checkingSavingsTotal)}・定期 ${amount(v.timeDepositTotal)}・預金総合計 ${amount(v.depositTotalAfterCollateral)}・消費税引当 ${amount(v.consumptionTaxReserve)}・賞与引当 ${amount(v.bonusReserve)}・引当後 当座・普通 ${amount(v.checkingSavingsAfterReserves)}・引当後 預金総合計 ${amount(v.depositTotalAfterReserves)}・資料更新日 ${date(v.sourceUpdatedOn)}`;
}

function HistoryToggle({ count, open, onToggle }: { count: number; open: boolean; onToggle: () => void }) {
  if (count === 0) return <span className="text-xs text-[var(--text-muted)]">なし</span>;
  return (
    <button type="button" onClick={onToggle} className="text-xs text-[var(--series-1)] hover:underline">
      {open ? "閉じる" : `${count}件`}
    </button>
  );
}

/**
 * A. 経理月次報告。freee(月次P/Lスナップショット)を主表示にし、当時の経理報告値と差額(freee − 経理)を
 * 併記する(ユーザー確定、2026-10-21)。経理の値は登録したまま、差額は補正せずそのまま出す
 */
function MonthlyReportTable({ rows }: { rows: AccountingReportsView["monthlyReports"] }) {
  const [openHistory, setOpenHistory] = useState<string | null>(null);
  if (rows.length === 0) return <p className="text-sm text-[var(--text-muted)]">登録された経理月次報告はありません。</p>;
  return (
    <TableShell>
      <thead>
        <HeadRow>
          <th className="px-3 py-2 text-left font-medium">対象月</th>
          <th className={TH}>売上高累計（freee）</th>
          <th className={TH}>当時の経理報告値</th>
          <th className={TH}>差額（freee − 経理）</th>
          <th className={TH}>経常利益累計（freee）</th>
          <th className={TH}>当時の経理報告値</th>
          <th className={TH}>差額（freee − 経理）</th>
          <th className="px-3 py-2 text-left font-medium">freee取得日時</th>
          <th className="px-3 py-2 text-left font-medium">経理報告の出所・日付</th>
          <th className="px-3 py-2 text-left font-medium">履歴</th>
        </HeadRow>
      </thead>
      <tbody>
        {rows.map(({ report, freee }) => {
          const v = report.values;
          const revenueDiff = difference(freee?.revenueCumulative, v.revenueCumulative);
          const ordinaryDiff = difference(freee?.ordinaryProfitCumulative, v.ordinaryProfitCumulative);
          const hasDiff = (revenueDiff !== null && revenueDiff !== 0) || (ordinaryDiff !== null && ordinaryDiff !== 0);
          const isOpen = openHistory === report.targetMonth;
          return (
            <Fragment key={report.targetMonth}>
              <tr className="border-t border-[var(--gridline)] align-top">
                <td className="px-3 py-2 whitespace-nowrap text-[var(--text-primary)]">{targetMonthLabel(report.targetMonth)}</td>
                <td className={`${TD} font-medium`}>{freee ? amount(freee.revenueCumulative) : "未取得"}</td>
                <td className={`${TD} text-[var(--text-secondary)]`}>{amount(v.revenueCumulative)}</td>
                <DiffCell value={revenueDiff} />
                <td className={`${TD} font-medium`}>{freee ? amount(freee.ordinaryProfitCumulative) : "未取得"}</td>
                <td className={`${TD} text-[var(--text-secondary)]`}>{amount(v.ordinaryProfitCumulative)}</td>
                <DiffCell value={ordinaryDiff} />
                <td className="px-3 py-2 text-xs whitespace-nowrap text-[var(--text-secondary)]">
                  {freee ? (
                    <>
                      <p>{dateTime(freee.fetchedAt)}</p>
                      <p className="text-[var(--text-muted)]">月次P/L</p>
                    </>
                  ) : (
                    "未取得"
                  )}
                </td>
                <td className="min-w-64 px-3 py-2 text-xs text-[var(--text-secondary)]">
                  <p className="text-[var(--text-primary)]">{v.documentName}</p>
                  <p>
                    集計基準日 {date(v.basisDate)}／資料の報告日 {date(v.reportDate)}／システム登録 {dateTime(report.createdAt)}
                    {report.updatedAt !== report.createdAt && `（最終更新 ${dateTime(report.updatedAt)} ${report.updatedBy}）`}
                  </p>
                  {hasDiff && (
                    <p className={v.differenceExplanation ? "" : "font-medium text-[var(--status-serious)]"}>
                      差額の原因: {v.differenceExplanation ?? "未確認"}
                    </p>
                  )}
                  {(v.prevYearRevenueCumulative !== null || v.prevYearOrdinaryProfitCumulative !== null) && (
                    <p>
                      資料記載の前期同月累計: 売上高 {amount(v.prevYearRevenueCumulative)}／経常利益{" "}
                      {amount(v.prevYearOrdinaryProfitCumulative)}
                    </p>
                  )}
                  {v.note && <p className="whitespace-pre-wrap">メモ: {v.note}</p>}
                </td>
                <td className="px-3 py-2">
                  <HistoryToggle
                    count={report.revisions.length}
                    open={isOpen}
                    onToggle={() => setOpenHistory(isOpen ? null : report.targetMonth)}
                  />
                </td>
              </tr>
              {isOpen && (
                <tr className="bg-[var(--surface-reference)]">
                  <td colSpan={10} className="px-3 py-2">
                    <RevisionList revisions={report.revisions} describe={describeMonthlyReport} />
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </TableShell>
  );
}

/** freee月末実績の欄。月末前・未取得は金額の代わりに状態を出す(0円とみなさない) */
function ActualCell({ actual, value }: { actual: CashPlanActual; value: number | null }) {
  if (actual.status === "beforeMonthEnd") return <td className={`${TD} text-[var(--text-muted)]`}>月末前</td>;
  if (actual.status === "notFetched") return <td className={`${TD} text-[var(--text-muted)]`}>未取得</td>;
  return <td className={`${TD} font-medium`}>{amount(value)}</td>;
}

function actualStatusLabel(actual: CashPlanActual): string {
  if (actual.status === "beforeMonthEnd") return "freee実績: 月末前";
  if (actual.status === "notFetched") return "freee実績: 未取得";
  return `freee実績（${dateTime(actual.fetchedAt)}取得）`;
}

/** 経理の管理予定値(担保控除・引当)。freee実績とは比べない */
const MANAGEMENT_PLAN_ITEMS: { key: keyof CashPlanValues; label: string }[] = [
  { key: "collateralDeduction", label: "担保控除額" },
  { key: "depositTotalAfterCollateral", label: "預金総合計（担保控除後）" },
  { key: "consumptionTaxReserve", label: "消費税引当" },
  { key: "bonusReserve", label: "賞与引当" },
  { key: "checkingSavingsAfterReserves", label: "引当控除後 当座・普通" },
  { key: "depositTotalAfterReserves", label: "引当控除後 預金総合計" },
];

function CashPlanCard({ plan, actual }: CashPlanWithActual) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const v = plan.values;
  const failed = checkCashPlan(v).filter((c) => c.difference !== 0);
  const kindsDiff = actual.status === "fetched" ? actualKindsDifference(actual) : 0;
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)] p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-sm font-semibold text-[var(--text-primary)]">{targetMonthLabel(plan.targetMonth)}末</h4>
        <span className="text-xs text-[var(--text-secondary)]">{actualStatusLabel(actual)}</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <HeadRow>
              <th className="px-3 py-2 text-left font-medium">項目</th>
              <th className={TH}>経理予定</th>
              <th className={TH}>freee月末実績</th>
              <th className={TH}>差額（freee − 経理）</th>
            </HeadRow>
          </thead>
          <tbody>
            {compareCashPlan(v, actual).map((row) => (
              <tr key={row.label} className="border-t border-[var(--gridline)]">
                <td className="px-3 py-2 whitespace-nowrap text-[var(--text-primary)]">{row.label}</td>
                <td className={TD}>{amount(row.planned)}</td>
                <ActualCell actual={actual} value={row.actual} />
                {actual.status === "fetched" ? <DiffCell value={row.difference} /> : <td className={`${TD} text-[var(--text-muted)]`}>―</td>}
              </tr>
            ))}
            <tr className="border-t border-[var(--gridline)] text-[var(--text-secondary)]">
              <td className="px-3 py-2 whitespace-nowrap">現金（freeeのみ）</td>
              <td className={`${TD} text-[var(--text-muted)]`}>―</td>
              <ActualCell actual={actual} value={actual.status === "fetched" ? actual.cashOnHand : null} />
              <td className={`${TD} text-xs text-[var(--text-muted)]`}>比較対象外</td>
            </tr>
          </tbody>
        </table>
      </div>
      {kindsDiff !== 0 && (
        <p className="text-xs font-medium text-[var(--status-serious)]">
          freeeの種類別残高（当座・普通＋定期＋現金）が月末現預金と合いません（差 {formatYen(kindsDiff)}）。分類できない預金科目がある可能性があります。
        </p>
      )}

      <div className="flex flex-col gap-1">
        <p className="text-xs text-[var(--text-muted)]">経理の管理予定値（freee実績とは比較しません）</p>
        <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-3">
          {MANAGEMENT_PLAN_ITEMS.map((item) => (
            <div key={item.key} className="flex justify-between gap-2 border-b border-[var(--gridline)] py-1">
              <dt className="text-[var(--text-secondary)]">{item.label}</dt>
              <dd className="tabular-nums text-[var(--text-primary)]">{amount(v[item.key] as number | null)}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="flex flex-col gap-0.5 text-xs text-[var(--text-secondary)]">
        <p>
          経理予定の出所: <span className="text-[var(--text-primary)]">{v.documentName}</span>／資料の更新日 {date(v.sourceUpdatedOn)}／
          {CHANGE_TYPE_LABELS[plan.changeType]} {dateTime(plan.updatedAt)}（{plan.updatedBy}）
        </p>
        {failed.map((c) => (
          <p key={c.label} className="font-medium text-[var(--status-serious)]">
            {c.difference === null
              ? `検算不可（項目が未入力）: ${c.label}`
              : `資料内の検算が合いません: ${c.label}（差 ${formatYen(c.difference)}）`}
          </p>
        ))}
        {v.note && <p className="whitespace-pre-wrap">メモ: {v.note}</p>}
        <p>
          変更履歴: <HistoryToggle count={plan.revisions.length} open={historyOpen} onToggle={() => setHistoryOpen(!historyOpen)} />
        </p>
        {historyOpen && <RevisionList revisions={plan.revisions} describe={describeCashPlan} />}
      </div>
    </div>
  );
}

/**
 * B. 資金繰り予定と月末実績。予定が登録されている対象月だけ、経理の予定値とfreeeの月末実績を比べる
 * (ユーザー確定、2026-10-21)。予定の値は資料のまま表示し、資料内の検算が合わない場合は警告だけ出す
 */
function CashPlanList({ items }: { items: CashPlanWithActual[] }) {
  const [showAll, setShowAll] = useState(false);
  if (items.length === 0) return <p className="text-sm text-[var(--text-muted)]">登録された資金繰り予定はありません。</p>;
  const visible = showAll ? items : items.slice(0, INITIAL_CASH_PLAN_COUNT);
  return (
    <div className="flex flex-col gap-2">
      {visible.map((item) => (
        <CashPlanCard key={item.plan.targetMonth} plan={item.plan} actual={item.actual} />
      ))}
      {items.length > INITIAL_CASH_PLAN_COUNT && (
        <button type="button" onClick={() => setShowAll(!showAll)} className="self-start text-xs text-[var(--series-1)] hover:underline">
          {showAll ? `直近${INITIAL_CASH_PLAN_COUNT}か月だけ表示` : `すべて表示（${items.length}件）`}
        </button>
      )}
    </div>
  );
}

function Heading({ title, note }: { title: string; note: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h3 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h3>
      <span className="text-xs text-[var(--text-muted)]">{note}</span>
    </div>
  );
}

/**
 * 経理月次報告・資金繰り予定(経営タブ最下部の独立セクション、ユーザー確定 2026-10-15)。
 * freeeで取れる実績(累計P/L・月末預金残高)はfreeeの既存スナップショットを主に表示し、経理資料の数字は
 * 報告当時の値のまま比較用に残す(2026-10-21)。経理の担保控除額・引当は管理予定値として扱い、
 * freeeの当座貸越利用額や「資金の備え」の準備額設定とは別項目のまま。
 */
export function AccountingReportsSection({ view }: { view: AccountingReportsView }) {
  return (
    <div className="flex flex-col gap-3">
      <SectionBanner>経理月次報告・資金繰り予定</SectionBanner>
      <p className="text-xs text-[var(--text-muted)]">
        freeeの値は既存の取得結果（定時更新・「更新」ボタン）で、取得日時の時点のものです。経理資料の数字は報告当時の値のまま記録しており、freeeの値が後から変わっても自動では書き換わりません。
      </p>

      <section className="flex flex-col gap-2">
        <Heading title="経理月次報告（実績）" note="差額 = freee − 経理。差額は補正せずそのまま表示" />
        <MonthlyReportTable rows={view.monthlyReports} />
      </section>

      <section className="flex flex-col gap-2">
        <Heading
          title="資金繰り予定と月末実績"
          note="予定は経理の資金繰り表、実績はfreeeの試算表の月末残高（月次決算の確定は判定していません）。差額 = freee − 経理。現金は差額に含めません"
        />
        <CashPlanList items={view.cashPlans} />
      </section>

      <AccountingReportForm monthlyReports={view.monthlyReports.map((r) => r.report)} cashPlans={view.cashPlans.map((c) => c.plan)} />
    </div>
  );
}
