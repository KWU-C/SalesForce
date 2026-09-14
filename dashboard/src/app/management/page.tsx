import type { Metadata } from "next";
import { DashboardNav } from "@/components/DashboardNav";
import { FreeeConnectForm } from "@/features/management-dashboard/FreeeConnectForm";
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
 * 経営ダッシュボード（freeeベース）のプレースホルダー。
 * freee OAuth認証基盤の実装、および実データでのKPIマッピング確定まで、
 * 推測値・仮のKPI表示は行わない（ユーザー確定、2026-09-14）。
 *
 * 閲覧は許可リスト(managementDashboardAccess)に載ったIAP検証済みメールのみに限定する
 * （ユーザー確定、2026-09-14）。ナビのタブ非表示だけでなく、URLを直接知っていても
 * 本文は表示しない。
 */
export default async function ManagementPage() {
  const iapEmail = await getRequestIapEmail();
  const authorized = isManagementDashboardAuthorized(iapEmail);

  let connectionStatus: Awaited<ReturnType<typeof getFreeeConnectionStatus>> | null = null;
  let authorizeUrl: string | null = null;
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
  }

  return (
    <>
      <DashboardNav active="/management" showManagementTab={authorized} />
      <main className="mx-auto flex max-w-3xl flex-1 flex-col gap-6 px-4 py-16 sm:px-6">
        {authorized ? (
          <>
            <div className="flex flex-col gap-2 text-center">
              <h1 className="text-xl font-semibold text-[var(--text-primary)]">経営ダッシュボード</h1>
              <p className="text-sm text-[var(--text-secondary)]">
                freee連携準備中です。認証基盤の実装とTCDの実データ（勘定科目・部門構成）の確認が
                完了次第、経営KPIを順次追加していきます。
              </p>
            </div>

            {connectionStatus?.connected ? (
              <div className="rounded-lg bg-[var(--surface-sunken)] p-4 text-center text-sm text-[var(--text-secondary)]">
                freee連携済み
                {connectionStatus.connectedBy ? `（接続者: ${connectionStatus.connectedBy}）` : ""}
                {connectionStatus.updatedAt
                  ? `／最終更新: ${formatDateTime(connectionStatus.updatedAt)}`
                  : ""}
              </div>
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
