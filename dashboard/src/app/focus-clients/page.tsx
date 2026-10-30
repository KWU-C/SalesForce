import type { Metadata } from "next";
import { RefreshButton } from "@/components/RefreshButton";
import { TermSelector } from "@/components/TermSelector";
import { FocusClientsView } from "@/features/focus-clients/FocusClientsView";
import { getFocusClients } from "@/repositories/focusClientRepository";
import {
  FISCAL_MONTH_ORDER,
  FISCAL_YEAR_END_MONTH,
  getCurrentFiscalPeriod,
  getSelectableTerms,
} from "@/config/fiscalPeriods";
import { getCrListForTerm } from "@/domain/types";
import { formatTime } from "@/utils/format";

// 毎リクエストSalesforce・Firestoreから取得する(営業進捗タブと同じ)
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "注力クライアント",
  description: "TCD 注力クライアント管理",
};

interface FocusClientsPageProps {
  searchParams: Promise<{ term?: string }>;
}

const FAILURE_MESSAGES = {
  master: "注力クライアントのメモ・営業戦略を取得できませんでした",
  salesforce: "Salesforceから注力クライアント・案件のデータを取得できませんでした",
} as const;

/**
 * 注力クライアント管理タブ(/focus-clients)。Salesforce取引先(一覧・会社名・担当・当期の目標)と
 * Salesforce案件(Process__c)をAccount IDで突合し、全注力クライアントの目標・実績・進捗・案件一覧を
 * 表示する。営業戦略・状況・アクション・メモはダッシュボード側(Firestore)で持ち、この画面から編集する
 * (ユーザー確定、2026-10-30)。
 */
export default async function FocusClientsPage({ searchParams }: FocusClientsPageProps) {
  const { term: actualTerm, currentMonth: actualCurrentMonth } = getCurrentFiscalPeriod();
  const availableTerms = getSelectableTerms();

  const requestedTermRaw = (await searchParams).term;
  const requestedTerm = requestedTermRaw ? Number(requestedTermRaw) : actualTerm;
  const selectedTerm =
    Number.isInteger(requestedTerm) && availableTerms.includes(requestedTerm) ? requestedTerm : actualTerm;
  const isCurrentTerm = selectedTerm === actualTerm;

  // 対象月の決め方は営業進捗タブと同じ(今期は当月、過去の期は期末月、来期は期首月)
  const displayMonth = isCurrentTerm
    ? actualCurrentMonth
    : selectedTerm > actualTerm
      ? FISCAL_MONTH_ORDER[0]
      : FISCAL_YEAR_END_MONTH;

  const loaded = await getFocusClients(selectedTerm, actualTerm);
  const fetchedAt = new Date();

  return (
    <>
      <header className="border-b border-[var(--border-hairline)] bg-[var(--surface-1)]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-baseline justify-between gap-2 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold text-[var(--text-primary)] sm:text-xl">注力クライアント</h1>
            <TermSelector availableTerms={availableTerms} selectedTerm={selectedTerm} />
          </div>
          <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
            <span>
              第{selectedTerm}期 {displayMonth}月時点
            </span>
            <span className="text-xs text-[var(--text-muted)]">
              {loaded.ok ? `取得日時 ${formatTime(fetchedAt)}` : "未取得"}
            </span>
            <RefreshButton />
          </div>
        </div>
      </header>
      <main className="flex-1 bg-[var(--background)]">
        {loaded.ok ? (
          <FocusClientsView
            masters={loaded.masters}
            deals={loaded.deals}
            scopeTargets={loaded.scopeTargets}
            crList={getCrListForTerm(selectedTerm)}
            term={selectedTerm}
            currentMonth={displayMonth}
          />
        ) : (
          <div className="mx-auto flex max-w-6xl flex-col items-center gap-2 px-4 py-24 text-center">
            <p className="text-base font-medium text-[var(--text-primary)]">{FAILURE_MESSAGES[loaded.failed]}</p>
            <p className="text-sm text-[var(--text-muted)]">
              しばらくしてから再度お試しください。問題が続く場合は管理者にご連絡ください。
            </p>
          </div>
        )}
      </main>
    </>
  );
}
