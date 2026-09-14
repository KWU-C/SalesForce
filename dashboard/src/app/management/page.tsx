import type { Metadata } from "next";
import { DashboardNav } from "@/components/DashboardNav";
import { FreeeConnectForm } from "@/features/management-dashboard/FreeeConnectForm";
import { FinancialSummaryCards } from "@/features/management-dashboard/FinancialSummaryCards";
import { getFinancialSummary } from "@/features/management-dashboard/financialSummary";
import type { FinancialSummary } from "@/features/management-dashboard/financialSummary";
import { getRequestIapEmail } from "@/services/iap/getRequestIapEmail";
import { isManagementDashboardAuthorized } from "@/config/managementDashboardAccess";
import { getFreeeConnectionStatus } from "@/repositories/freeeAuthRepository";
import { buildFreeeAuthorizeUrl } from "@/services/freee/freeeTokenClient";
import { formatDateTime } from "@/utils/format";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "経営ダッシュボード",
  description: "TCD 経営ダッシュボード（freeeベース）",
};

/**
 * 経営ダッシュボード（freeeベース）。
 * 閲覧は許可リスト(managementDashboardAccess)に載ったIAP検証済みメールのみに限定する
 * （ユーザー確定、2026-09-14）。ナビのタブ非表示だけでなく、URLを直接知っていても
 * 本文は表示しない。
 *
 * KPIは実データから取得できたものだけを表示し、取得できない項目は「データ未設定」と
 * 表示する(推測値・仮の値は一切出さない、ユーザー確定の方針)。
 */
export default async function ManagementPage() {
  const iapEmail = await getRequestIapEmail();
  const authorized = isManagementDashboardAuthorized(iapEmail);

  let connectionStatus: Awaited<ReturnType<typeof getFreeeConnectionStatus>> | null = null;
  let authorizeUrl: string | null = null;
  let financialSummary: FinancialSummary | null = null;
  let financialSummaryError = false;
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
      try {
        financialSummary = await getFinancialSummary();
      } catch {
        console.error("[management page] freeeからの経営サマリー取得に失敗しました");
        financialSummaryError = true;
      }
    }
  }

  return (
    <>
      <DashboardNav active="/management" showManagementTab={authorized} />
      <main className="mx-auto flex max-w-5xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
        {authorized ? (
          <>
            <h1 className="text-xl font-semibold text-[var(--text-primary)]">経営ダッシュボード</h1>

            {connectionStatus?.connected ? (
              <>
                <p className="text-xs text-[var(--text-muted)]">
                  freee連携済み
                  {connectionStatus.connectedBy ? `（接続者: ${connectionStatus.connectedBy}）` : ""}
                  {connectionStatus.updatedAt
                    ? `／最終更新: ${formatDateTime(connectionStatus.updatedAt)}`
                    : ""}
                </p>
                {financialSummary ? (
                  <FinancialSummaryCards summary={financialSummary} />
                ) : financialSummaryError ? (
                  <p className="text-center text-sm text-[var(--text-muted)]">
                    freeeからのデータ取得に失敗しました。時間をおいて再度お試しください。
                  </p>
                ) : null}
              </>
            ) : authorizeUrl ? (
              <FreeeConnectForm authorizeUrl={authorizeUrl} />
            ) : (
              <p className="text-center text-sm text-[var(--text-muted)]">
                freee連携の設定が未完了です（Secret Manager未接続）。
              </p>
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
