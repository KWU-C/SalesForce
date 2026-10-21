"use client";

import { useState } from "react";
import { formatDateTime, formatYen } from "@/utils/format";
import { SectionBanner } from "./SectionBanner";
import { actualKindsDifference, compareCashPlan, targetMonthLabel } from "./accountingReports";
import type { CashPlanActual } from "./accountingReports";
import type { AccountingReportsView, CashPlanWithActual } from "./accountingReportsService";

/** 資金繰り予定の初期表示件数(直近6か月、ユーザー確定 2026-10-15) */
const INITIAL_CASH_PLAN_COUNT = 6;

const TH = "px-3 py-2 text-right font-medium";
const TD = "px-3 py-2 text-right tabular-nums whitespace-nowrap";

function amount(value: number | null | undefined): string {
  return value === null || value === undefined ? "―" : formatYen(value);
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

function HeadRow({ children }: { children: React.ReactNode }) {
  return (
    <tr className="border-b border-[var(--gridline)] bg-[var(--surface-sunken)] text-xs whitespace-nowrap text-[var(--text-muted)]">
      {children}
    </tr>
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

/** 予定の基準日(資金繰り表の更新日)。記載が無ければ「基準日なし」 */
function planBasisLabel(sourceUpdatedOn: string | null): string {
  return sourceUpdatedOn ? `予定 ${sourceUpdatedOn.replaceAll("-", "/")}時点` : "予定 基準日なし";
}

function CashPlanCard({ plan, actual }: CashPlanWithActual) {
  const kindsDiff = actual.status === "fetched" ? actualKindsDifference(actual) : 0;
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)] p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h4 className="text-sm font-semibold text-[var(--text-primary)]">{targetMonthLabel(plan.targetMonth)}末</h4>
        <span className="text-xs text-[var(--text-secondary)]">
          {planBasisLabel(plan.values.sourceUpdatedOn)}／{actualStatusLabel(actual)}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <HeadRow>
              <th className="px-3 py-2 text-left font-medium">項目</th>
              <th className={TH}>予定</th>
              <th className={TH}>freee月末実績</th>
              <th className={TH}>差額（freee − 予定）</th>
            </HeadRow>
          </thead>
          <tbody>
            {compareCashPlan(plan.values, actual).map((row) => (
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
    </div>
  );
}

/**
 * 資金繰り見通し(経営タブ最下部、ユーザー確定 2026-10-21)。登録済みの資金繰り予定がある対象月だけ、
 * 予定とfreeeの月末実績(当座・普通/定期/担保控除前の合計、現金は別行)を比べる。
 * PDF由来の資料名・登録者・メモ・変更履歴、担保控除・引当の予定値、登録フォームは画面に出さない
 * (Firestoreのデータ・変更履歴はそのまま残す)。引当・担保は「資金の備え」の設定値で見る。
 */
export function AccountingReportsSection({ view }: { view: AccountingReportsView }) {
  const [showAll, setShowAll] = useState(false);
  const items = view.cashPlans;
  const visible = showAll ? items : items.slice(0, INITIAL_CASH_PLAN_COUNT);
  return (
    <div className="flex flex-col gap-3">
      <SectionBanner>資金繰り見通し</SectionBanner>
      <p className="text-xs text-[var(--text-muted)]">
        予定は登録済みの資金繰り予定（基準日時点）、実績はfreeeの試算表の月末残高（取得日時の時点。月次決算の確定は判定していません）。差額 =
        freee − 予定。現金は差額に含めません。
      </p>
      {items.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">登録された資金繰り予定はありません。</p>
      ) : (
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
      )}
    </div>
  );
}
