import type { Metadata } from "next";
import { DashboardNav } from "@/components/DashboardNav";
import { FreeeConnectForm } from "@/features/management-dashboard/FreeeConnectForm";
import { FinancialSummaryCards } from "@/features/management-dashboard/FinancialSummaryCards";
import { getFinancialSummary } from "@/features/management-dashboard/financialSummary";
import type { FinancialSummary } from "@/features/management-dashboard/financialSummary";
import { MonthSelector } from "@/features/management-dashboard/MonthSelector";
import { MonthlyCashFlowTable } from "@/features/management-dashboard/MonthlyCashFlowTable";
import { getOrFetchMonthlyCashFlow } from "@/features/management-dashboard/monthlyCashFlowService";
import type { MonthlyCashFlow } from "@/features/management-dashboard/types";
import { LoanStatusTable } from "@/features/management-dashboard/LoanStatusTable";
import { getOrFetchLoanStatus } from "@/features/management-dashboard/loanStatusService";
import type { LoanStatusSnapshot } from "@/features/management-dashboard/loanStatus";
import { FundReserveSection } from "@/features/management-dashboard/FundReserveSection";
import { composeFundReserve } from "@/features/management-dashboard/fundReserve";
import type { FundReserve } from "@/features/management-dashboard/fundReserve";
import { getOrFetchFundReserveCore } from "@/features/management-dashboard/fundReserveService";
import { ManagementSummary } from "@/features/management-dashboard/ManagementSummary";
import { ExpenseCompositionSection } from "@/features/management-dashboard/ExpenseCompositionSection";
import { getRequestIapEmail } from "@/services/iap/getRequestIapEmail";
import { isManagementDashboardAuthorized } from "@/config/managementDashboardAccess";
import { getFreeeConnectionStatus } from "@/repositories/freeeAuthRepository";
import { buildFreeeAuthorizeUrl } from "@/services/freee/freeeTokenClient";
import {
  FISCAL_MONTH_ORDER,
  freeeFiscalYearForTerm,
  getCurrentFiscalPeriod,
  getSelectableTerms,
  previousFiscalTermMonth,
} from "@/config/fiscalPeriods";
import { formatDateTime } from "@/utils/format";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "経営ダッシュボード",
  description: "TCD 経営ダッシュボード（freeeベース）",
};

interface PageProps {
  searchParams: Promise<{ term?: string; month?: string }>;
}

/**
 * ?term=/?month=を選択可能な範囲(現在・前期・前々期 × 各期の期首月〜当月/期末月)へ
 * クランプする。期の変わり目直後は当期の経過月が1ヶ月だけになるため、前期以前へも
 * 移動できるようにする(ユーザー確定、2026-09-14)。範囲外・不正値は当期・当月へ
 * フォールバックする。
 */
function resolveSelectedPeriod(
  requestedTermRaw: string | undefined,
  requestedMonthRaw: string | undefined,
  currentTerm: number,
  currentMonth: number,
  minTerm: number
): { term: number; month: number } {
  const fallback = { term: currentTerm, month: currentMonth };
  const requestedTerm = requestedTermRaw ? Number(requestedTermRaw) : currentTerm;
  const requestedMonth = requestedMonthRaw ? Number(requestedMonthRaw) : currentMonth;

  if (!Number.isInteger(requestedTerm) || requestedTerm < minTerm || requestedTerm > currentTerm) {
    return fallback;
  }
  const monthIndex = FISCAL_MONTH_ORDER.indexOf(requestedMonth);
  if (monthIndex === -1) {
    return fallback;
  }
  if (requestedTerm === currentTerm) {
    const currentIndex = FISCAL_MONTH_ORDER.indexOf(currentMonth);
    if (monthIndex > currentIndex) return fallback;
  }
  return { term: requestedTerm, month: requestedMonth };
}

/**
 * 経営ダッシュボード（freeeベース）。
 * 閲覧は許可リスト(managementDashboardAccess)に載ったIAP検証済みメールのみに限定する
 * （ユーザー確定、2026-09-14）。ナビのタブ非表示だけでなく、URLを直接知っていても
 * 本文は表示しない。
 *
 * 「会社版家計簿」として、会計上の利益ではなく実際の現金の動き(入金・支出・現金増減)を
 * 主役とする月次資金収支表を表示する(ユーザー確定、2026-09-14。freeeの試算表を
 * そのまま複製しない)。値は実データから取得できたものだけを表示し、取得できない項目は
 * 「データ未設定」と表示する（推測値・仮の値は一切出さない）。
 */
export default async function ManagementPage({ searchParams }: PageProps) {
  const iapEmail = await getRequestIapEmail();
  const authorized = isManagementDashboardAuthorized(iapEmail);

  let connectionStatus: Awaited<ReturnType<typeof getFreeeConnectionStatus>> | null = null;
  let authorizeUrl: string | null = null;
  let financialSummary: FinancialSummary | null = null;
  let financialSummaryError = false;
  let cashFlow: MonthlyCashFlow | null = null;
  let cashFlowError = false;
  let loanStatus: LoanStatusSnapshot | null = null;
  let loanStatusError = false;
  let fundReserve: FundReserve | null = null;
  let fundReserveError = false;
  let previousMonthCashClosing: number | null = null;

  const { term: currentTerm, currentMonth } = getCurrentFiscalPeriod();
  const minTerm = Math.min(...getSelectableTerms());
  const { term: selectedTerm, month: selectedMonth } = resolveSelectedPeriod(
    (await searchParams).term,
    (await searchParams).month,
    currentTerm,
    currentMonth,
    minTerm
  );
  const fiscalYear = freeeFiscalYearForTerm(selectedTerm);

  if (authorized) {
    try {
      connectionStatus = await getFreeeConnectionStatus();
    } catch {
      console.error("[management page] freee接続状態の取得に失敗しました");
    }
    // FREEE_CLIENT_ID/SECRET未設定の間(Secret Manager未接続)は、連携フォームを
    // 出さず案内のみ表示する。ページ全体は落とさない(fail-safe)
    try {
      authorizeUrl = buildFreeeAuthorizeUrl();
    } catch {
      console.error("[management page] FREEE_CLIENT_ID/SECRET未設定のため連携フォームを表示しません");
    }

    if (connectionStatus?.connected) {
      const isCurrentMonth = selectedTerm === currentTerm && selectedMonth === currentMonth;
      try {
        cashFlow = await getOrFetchMonthlyCashFlow(fiscalYear, selectedMonth, { forceRefresh: isCurrentMonth });
      } catch (error) {
        // ここで出すのは自前でthrowしているエラーメッセージのみ(freee_api_error等の固定文言、
        // トークン等の機微情報は含まない)。原因切り分けのための一時的な診断ログ
        const detail = error instanceof Error ? error.message : String(error);
        console.error(`[management page] freeeからの月次資金収支取得に失敗しました: ${detail}`);
        cashFlowError = true;
      }
      // 経営サマリーの「前月比」用。前月は常に過去月なのでforceRefreshせず
      // Firestore優先(遅延バックフィル)で取得する(ユーザー確定、2026-09-15)
      try {
        const { term: prevTerm, month: prevMonth } = previousFiscalTermMonth(selectedTerm, selectedMonth);
        const prevFiscalYear = freeeFiscalYearForTerm(prevTerm);
        const previousCashFlow = await getOrFetchMonthlyCashFlow(prevFiscalYear, prevMonth, { forceRefresh: false });
        previousMonthCashClosing = previousCashFlow?.cashClosing ?? null;
      } catch {
        console.error("[management page] freeeからの前月データ取得に失敗しました");
      }
      try {
        loanStatus = await getOrFetchLoanStatus(fiscalYear, selectedMonth, { forceRefresh: isCurrentMonth });
      } catch {
        console.error("[management page] freeeからの借入状況取得に失敗しました");
        loanStatusError = true;
      }
      try {
        const fundReserveCore = await getOrFetchFundReserveCore(fiscalYear, selectedMonth, {
          forceRefresh: isCurrentMonth,
        });
        fundReserve = fundReserveCore ? composeFundReserve(fundReserveCore, cashFlow?.cashClosing ?? null) : null;
      } catch {
        console.error("[management page] freeeからの資金の備え取得に失敗しました");
        fundReserveError = true;
      }
      try {
        financialSummary = await getFinancialSummary();
      } catch {
        console.error("[management page] freeeからの当期累計サマリー取得に失敗しました");
        financialSummaryError = true;
      }
    }
  }

  // ネットキャッシュ(現預金－借入残高)は経営サマリー・資金の備えの両方で使うため、
  // ページ側で一度だけ合成する(同じデータソース・値をUI側で再計算しない、ユーザー確定)
  const netCash =
    fundReserve?.cash === null || fundReserve?.cash === undefined || loanStatus === null
      ? null
      : fundReserve.cash - loanStatus.totalCurrent;

  // 経営サマリーの「前月比」。cashFlow.cashClosingとpreviousMonthCashClosingの
  // 両方が揃っている場合のみ計算し、片方でも欠けていればnull(推測値を出さない)
  const cashClosingDiffFromPreviousMonth =
    cashFlow?.cashClosing == null || previousMonthCashClosing === null
      ? null
      : cashFlow.cashClosing - previousMonthCashClosing;

  return (
    <>
      <DashboardNav active="/management" showManagementTab={authorized} />
      <main className="mx-auto flex max-w-5xl flex-1 flex-col gap-8 px-4 py-10 sm:px-6">
        {authorized ? (
          <>
            <h1 className="text-center text-xl font-semibold text-[var(--text-primary)]">経営ダッシュボード</h1>

            {connectionStatus?.connected && (
              <p className="text-center text-xs text-[var(--text-muted)]">
                freee連携済み
                {connectionStatus.connectedBy ? `（接続者: ${connectionStatus.connectedBy}）` : ""}
                {connectionStatus.updatedAt
                  ? `／最終更新: ${formatDateTime(connectionStatus.updatedAt)}`
                  : ""}
              </p>
            )}

            {connectionStatus?.connected ? (
              <>
                <MonthSelector
                  selectedTerm={selectedTerm}
                  selectedMonth={selectedMonth}
                  currentTerm={currentTerm}
                  currentMonth={currentMonth}
                  minTerm={minTerm}
                />

                <ManagementSummary
                  term={selectedTerm}
                  month={selectedMonth}
                  cashFlow={cashFlow}
                  loanStatus={loanStatus}
                  fundReserve={fundReserve}
                  netCash={netCash}
                  cashClosingDiffFromPreviousMonth={cashClosingDiffFromPreviousMonth}
                />

                {cashFlow && (
                  <ExpenseCompositionSection
                    expenseByCategory={cashFlow.expenseByCategory}
                    externalExpenseTotal={cashFlow.externalExpenseTotal}
                  />
                )}

                {cashFlowError && (
                  <p className="text-center text-sm text-[var(--text-muted)]">
                    freeeからのデータ取得に失敗しました（権限不足の場合、freeeアプリの権限設定を
                    変更した後は再接続が必要です。下記から再度お試しください）。
                  </p>
                )}

                {cashFlow && (
                  <MonthlyCashFlowTable fiscalYear={fiscalYear} month={selectedMonth} cashFlow={cashFlow} />
                )}

                {loanStatusError && (
                  <p className="text-center text-sm text-[var(--text-muted)]">借入状況の取得に失敗しました。</p>
                )}
                {loanStatus && <LoanStatusTable loanStatus={loanStatus} />}

                {fundReserveError && (
                  <p className="text-center text-sm text-[var(--text-muted)]">資金の備えの取得に失敗しました。</p>
                )}
                {fundReserve && (
                  <FundReserveSection
                    fundReserve={fundReserve}
                    loanTotalCurrent={loanStatus?.totalCurrent ?? null}
                    netCash={netCash}
                  />
                )}

                {financialSummary && <FinancialSummaryCards summary={financialSummary} />}
                {financialSummaryError && (
                  <p className="text-center text-sm text-[var(--text-muted)]">
                    当期累計データの取得に失敗しました。
                  </p>
                )}
              </>
            ) : authorizeUrl ? (
              <FreeeConnectForm authorizeUrl={authorizeUrl} mode="connect" />
            ) : (
              <p className="text-center text-sm text-[var(--text-muted)]">
                freee連携の設定が未完了です（Secret Manager未接続）。
              </p>
            )}

            {connectionStatus?.connected && authorizeUrl && (
              <FreeeConnectForm authorizeUrl={authorizeUrl} mode="reconnect" />
            )}
          </>
        ) : (
          <div className="flex flex-col gap-2 py-8 text-center">
            <h1 className="text-xl font-semibold text-[var(--text-primary)]">アクセス権がありません</h1>
            <p className="text-sm text-[var(--text-secondary)]">このページの閲覧権限がありません。</p>
          </div>
        )}
      </main>
    </>
  );
}
