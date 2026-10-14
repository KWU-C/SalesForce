import type { Metadata } from "next";
import { RefreshButton } from "@/components/RefreshButton";
import { TermSelector } from "@/components/TermSelector";
import { ClientTargetsView } from "@/features/client-targets/ClientTargetsView";
import type { ClientTargetScope } from "@/features/client-targets/clientTargets";
import { getClientTargetProgress } from "@/repositories/clientTargetRepository";
import {
  FISCAL_MONTH_ORDER,
  FISCAL_YEAR_END_MONTH,
  getCurrentFiscalPeriod,
  getSelectableTerms,
} from "@/config/fiscalPeriods";
import { getConcreteCrIdsForTerm, getCrListForTerm } from "@/domain/types";
import { formatTime } from "@/utils/format";

// 毎リクエストSalesforceから取得する(営業進捗タブと同じ)
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "クライアント別目標",
  description: "TCD CR×クライアント別 目標進捗",
};

interface ClientTargetsPageProps {
  searchParams: Promise<{ term?: string }>;
}

/**
 * クライアント別目標タブ(/client-targets)。CR×クライアントごとの年間目標に対する
 * 完了粗利(主指標、請求日基準)と受注粗利(先行指標、受注日基準)の進捗を表示する。
 * 営業進捗タブのデータ取得・集計には触れない独立した機能(ユーザー確定、2026-10-14)。
 */
export default async function ClientTargetsPage({ searchParams }: ClientTargetsPageProps) {
  const { term: actualTerm, currentMonth: actualCurrentMonth } = getCurrentFiscalPeriod();
  const availableTerms = getSelectableTerms();

  const requestedTermRaw = (await searchParams).term;
  const requestedTerm = requestedTermRaw ? Number(requestedTermRaw) : actualTerm;
  const selectedTerm =
    Number.isInteger(requestedTerm) && availableTerms.includes(requestedTerm) ? requestedTerm : actualTerm;

  // 対象月の決め方は営業進捗タブと同じ(今期は当月、過去の期は期末月、来期は期首月)
  const displayMonth =
    selectedTerm === actualTerm
      ? actualCurrentMonth
      : selectedTerm > actualTerm
        ? FISCAL_MONTH_ORDER[0]
        : FISCAL_YEAR_END_MONTH;

  const scopes: ClientTargetScope[] | null = await getClientTargetProgress(
    selectedTerm,
    getConcreteCrIdsForTerm(selectedTerm),
    displayMonth
  );
  const fetchedAt = new Date();

  return (
    <>
      <header className="border-b border-[var(--border-hairline)] bg-[var(--surface-1)]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-baseline justify-between gap-2 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold text-[var(--text-primary)] sm:text-xl">クライアント別目標</h1>
            <TermSelector availableTerms={availableTerms} selectedTerm={selectedTerm} />
          </div>
          <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
            <span>
              第{selectedTerm}期 {displayMonth}月時点
            </span>
            <span className="text-xs text-[var(--text-muted)]">
              {scopes ? `取得日時 ${formatTime(fetchedAt)}` : "未取得"}
            </span>
            <RefreshButton />
          </div>
        </div>
      </header>
      <main className="flex-1 bg-[var(--background)]">
        {scopes ? (
          <ClientTargetsView scopes={scopes} crList={getCrListForTerm(selectedTerm)} currentMonth={displayMonth} />
        ) : (
          <div className="mx-auto flex max-w-6xl flex-col items-center gap-2 px-4 py-24 text-center">
            <p className="text-base font-medium text-[var(--text-primary)]">クライアント別目標のデータを取得できませんでした</p>
            <p className="text-sm text-[var(--text-muted)]">
              しばらくしてから再度お試しください。問題が続く場合は管理者にご連絡ください。
            </p>
          </div>
        )}
      </main>
    </>
  );
}
