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
import { getRequestIapEmail } from "@/services/iap/getRequestIapEmail";
import { isManagementDashboardAuthorized } from "@/config/managementDashboardAccess";
import { getFreeeConnectionStatus } from "@/repositories/freeeAuthRepository";
import { buildFreeeAuthorizeUrl } from "@/services/freee/freeeTokenClient";
import { FISCAL_MONTH_ORDER, freeeFiscalYearForTerm, getCurrentFiscalPeriod } from "@/config/fiscalPeriods";
import { formatDateTime } from "@/utils/format";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "経営ダッシュボード",
  description: "TCD 経営ダッシュボード（freeeベース）",
};

interface PageProps {
  searchParams: Promise<{ month?: string }>;
}

/** ?month=の値を今期の期首月〜当月の範囲にクランプする。範囲外・不正値は当月にフォールバック */
function resolveSelectedMonth(requestedMonthRaw: string | undefined, currentMonth: number): number {
  const requested = requestedMonthRaw ? Number(requestedMonthRaw) : currentMonth;
  const requestedIndex = FISCAL_MONTH_ORDER.indexOf(requested);
  const currentIndex = FISCAL_MONTH_ORDER.indexOf(currentMonth);
  if (requestedIndex === -1 || requestedIndex > currentIndex) return currentMonth;
  return requested;
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

  const { term, currentMonth } = getCurrentFiscalPeriod();
  const selectedMonth = resolveSelectedMonth((await searchParams).month, currentMonth);
  const fiscalYear = freeeFiscalYearForTerm(term);

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
      const isCurrentMonth = selectedMonth === currentMonth;
      try {
        cashFlow = await getOrFetchMonthlyCashFlow(fiscalYear, selectedMonth, { forceRefresh: isCurrentMonth });
      } catch (error) {
        // ここで出すのは自前でthrowしているエラーメッセージのみ(freee_api_error等の固定文言、
        // トークン等の機微情報は含まない)。原因切り分けのための一時的な診断ログ
        const detail = error instanceof Error ? error.message : String(error);
        console.error(`[management page] freeeからの月次資金収支取得に失敗しました: ${detail}`);
        cashFlowError = true;
      }
      try {
        financialSummary = await getFinancialSummary();
      } catch {
        console.error("[management page] freeeからの当期累計サマリー取得に失敗しました");
        financialSummaryError = true;
      }
    }
  }

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
                <MonthSelector term={term} selectedMonth={selectedMonth} currentMonth={currentMonth} />

                {cashFlowError && (
                  <p className="text-center text-sm text-[var(--text-muted)]">
                    freeeからのデータ取得に失敗しました（権限不足の場合、freeeアプリの権限設定を
                    変更した後は再接続が必要です。下記から再度お試しください）。
                  </p>
                )}

                {cashFlow && (
                  <MonthlyCashFlowTable fiscalYear={fiscalYear} month={selectedMonth} cashFlow={cashFlow} />
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
