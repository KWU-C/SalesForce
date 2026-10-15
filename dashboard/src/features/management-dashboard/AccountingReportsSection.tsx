"use client";

import { Fragment, useState } from "react";
import { formatDateTime, formatYen } from "@/utils/format";
import { SectionBanner } from "./SectionBanner";
import { AccountingReportForm } from "./AccountingReportForm";
import { CHANGE_TYPE_LABELS, checkCashPlan, difference, targetMonthLabel } from "./accountingReports";
import type { CashPlan, CashPlanValues, MonthlyReportValues, Revision } from "./accountingReports";
import type { AccountingReportsView } from "./accountingReportsService";

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

/** A. 経理月次報告。経理の値は登録したまま、freeeの値は月次P/Lスナップショットのもの。差額はそのまま出す */
function MonthlyReportTable({ rows }: { rows: AccountingReportsView["monthlyReports"] }) {
  const [openHistory, setOpenHistory] = useState<string | null>(null);
  if (rows.length === 0) return <p className="text-sm text-[var(--text-muted)]">登録された経理月次報告はありません。</p>;
  return (
    <TableShell>
      <thead>
        <HeadRow>
          <th className="px-3 py-2 text-left font-medium">対象月</th>
          <th className={TH}>売上高累計（経理）</th>
          <th className={TH}>売上高累計（freee）</th>
          <th className={TH}>差額</th>
          <th className={TH}>経常利益累計（経理）</th>
          <th className={TH}>経常利益累計（freee）</th>
          <th className={TH}>差額</th>
          <th className="px-3 py-2 text-left font-medium">出所・日付</th>
          <th className="px-3 py-2 text-left font-medium">履歴</th>
        </HeadRow>
      </thead>
      <tbody>
        {rows.map(({ report, freee }) => {
          const v = report.values;
          const revenueDiff = difference(v.revenueCumulative, freee?.revenueCumulative);
          const ordinaryDiff = difference(v.ordinaryProfitCumulative, freee?.ordinaryProfitCumulative);
          const hasDiff = (revenueDiff !== null && revenueDiff !== 0) || (ordinaryDiff !== null && ordinaryDiff !== 0);
          const isOpen = openHistory === report.targetMonth;
          return (
            <Fragment key={report.targetMonth}>
              <tr className="border-t border-[var(--gridline)] align-top">
                <td className="px-3 py-2 whitespace-nowrap text-[var(--text-primary)]">{targetMonthLabel(report.targetMonth)}</td>
                <td className={TD}>{amount(v.revenueCumulative)}</td>
                <td className={`${TD} text-[var(--text-secondary)]`}>{freee ? amount(freee.revenueCumulative) : "未取得"}</td>
                <DiffCell value={revenueDiff} />
                <td className={TD}>{amount(v.ordinaryProfitCumulative)}</td>
                <td className={`${TD} text-[var(--text-secondary)]`}>{freee ? amount(freee.ordinaryProfitCumulative) : "未取得"}</td>
                <DiffCell value={ordinaryDiff} />
                <td className="min-w-64 px-3 py-2 text-xs text-[var(--text-secondary)]">
                  <p className="text-[var(--text-primary)]">{v.documentName}</p>
                  <p>
                    集計基準日 {date(v.basisDate)}／資料の報告日 {date(v.reportDate)}／システム登録 {dateTime(report.createdAt)}
                    {report.updatedAt !== report.createdAt && `（最終更新 ${dateTime(report.updatedAt)} ${report.updatedBy}）`}
                  </p>
                  <p>freee比較値: {freee ? `月次P/L ${dateTime(freee.fetchedAt)}取得` : "その月の月次P/Lが未取得"}</p>
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
                  <td colSpan={9} className="px-3 py-2">
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

/** B. 資金繰り予定。資料の値をそのまま表示し、資料内の検算が合わない場合は警告だけ出す */
function CashPlanTable({ plans }: { plans: CashPlan[] }) {
  const [showAll, setShowAll] = useState(false);
  const [openHistory, setOpenHistory] = useState<string | null>(null);
  if (plans.length === 0) return <p className="text-sm text-[var(--text-muted)]">登録された資金繰り予定はありません。</p>;
  const visible = showAll ? plans : plans.slice(0, INITIAL_CASH_PLAN_COUNT);
  return (
    <div className="flex flex-col gap-2">
      <TableShell>
        <thead>
          <HeadRow>
            <th className="px-3 py-2 text-left font-medium">対象月末</th>
            <th className={TH}>当座・普通預金合計</th>
            <th className={TH}>定期預金</th>
            <th className={TH}>担保控除額（経理）</th>
            <th className={TH}>預金総合計（担保控除後）</th>
            <th className={TH}>消費税引当</th>
            <th className={TH}>賞与引当</th>
            <th className={TH}>引当控除後 当座・普通</th>
            <th className={TH}>引当控除後 預金総合計</th>
            <th className="px-3 py-2 text-left font-medium">出所・日付</th>
            <th className="px-3 py-2 text-left font-medium">履歴</th>
          </HeadRow>
        </thead>
        <tbody>
          {visible.map((plan) => {
            const v = plan.values;
            const failed = checkCashPlan(v).filter((c) => c.difference !== 0);
            const isOpen = openHistory === plan.targetMonth;
            return (
              <Fragment key={plan.targetMonth}>
                <tr className="border-t border-[var(--gridline)] align-top">
                  <td className="px-3 py-2 whitespace-nowrap text-[var(--text-primary)]">{targetMonthLabel(plan.targetMonth)}末</td>
                  <td className={TD}>{amount(v.checkingSavingsTotal)}</td>
                  <td className={TD}>{amount(v.timeDepositTotal)}</td>
                  <td className={TD}>{amount(v.collateralDeduction)}</td>
                  <td className={`${TD} font-medium`}>{amount(v.depositTotalAfterCollateral)}</td>
                  <td className={TD}>{amount(v.consumptionTaxReserve)}</td>
                  <td className={TD}>{amount(v.bonusReserve)}</td>
                  <td className={TD}>{amount(v.checkingSavingsAfterReserves)}</td>
                  <td className={`${TD} font-semibold`}>{amount(v.depositTotalAfterReserves)}</td>
                  <td className="min-w-64 px-3 py-2 text-xs text-[var(--text-secondary)]">
                    <p className="text-[var(--text-primary)]">{v.documentName}</p>
                    <p>
                      資料の更新日 {date(v.sourceUpdatedOn)}／{CHANGE_TYPE_LABELS[plan.changeType]} {dateTime(plan.updatedAt)}（
                      {plan.updatedBy}）
                    </p>
                    {failed.map((c) => (
                      <p key={c.label} className="font-medium text-[var(--status-serious)]">
                        {c.difference === null
                          ? `検算不可（項目が未入力）: ${c.label}`
                          : `資料内の検算が合いません: ${c.label}（差 ${formatYen(c.difference)}）`}
                      </p>
                    ))}
                    {v.note && <p className="whitespace-pre-wrap">メモ: {v.note}</p>}
                  </td>
                  <td className="px-3 py-2">
                    <HistoryToggle
                      count={plan.revisions.length}
                      open={isOpen}
                      onToggle={() => setOpenHistory(isOpen ? null : plan.targetMonth)}
                    />
                  </td>
                </tr>
                {isOpen && (
                  <tr className="bg-[var(--surface-reference)]">
                    <td colSpan={11} className="px-3 py-2">
                      <RevisionList revisions={plan.revisions} describe={describeCashPlan} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </TableShell>
      {plans.length > INITIAL_CASH_PLAN_COUNT && (
        <button type="button" onClick={() => setShowAll(!showAll)} className="self-start text-xs text-[var(--series-1)] hover:underline">
          {showAll ? `直近${INITIAL_CASH_PLAN_COUNT}か月だけ表示` : `すべて表示（${plans.length}件）`}
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
 * freeeの実績表示・「資金の備え」とは独立した、経理資料の数字の記録。経理の担保控除額は
 * freeeの当座貸越利用額とは別項目として扱う。
 */
export function AccountingReportsSection({ view }: { view: AccountingReportsView }) {
  return (
    <div className="flex flex-col gap-3">
      <SectionBanner>経理月次報告・資金繰り予定</SectionBanner>
      <p className="text-xs text-[var(--text-muted)]">
        経理資料の数字を報告当時の値のまま記録しています。freeeの値が後から変わっても、この記録は自動では書き換わりません。
      </p>

      <section className="flex flex-col gap-2">
        <Heading title="経理月次報告（実績）" note="差額 = 経理 − freee。差額は補正せずそのまま表示" />
        <MonthlyReportTable rows={view.monthlyReports} />
      </section>

      <section className="flex flex-col gap-2">
        <Heading
          title="資金繰り予定（対象月末の予定値）"
          note="担保控除額は経理の値で、借入状況の当座貸越利用額（freee）とは別項目"
        />
        <CashPlanTable plans={view.cashPlans} />
      </section>

      <AccountingReportForm monthlyReports={view.monthlyReports.map((r) => r.report)} cashPlans={view.cashPlans} />
    </div>
  );
}
