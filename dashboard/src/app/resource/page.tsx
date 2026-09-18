import type { Metadata } from "next";
import { ResourceLoadTable } from "@/features/resource-load/ResourceLoadTable";
import { getResourceLoad } from "@/repositories/resourceLoadRepository";
import type { ResourceLoadResult } from "@/features/resource-load/resourceLoad";
import { getRequestIapEmail } from "@/services/iap/getRequestIapEmail";
import { isManagementDashboardAuthorized } from "@/config/managementDashboardAccess";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "リソース",
  description: "TCD リソースダッシュボード（推定負荷率）",
};

/**
 * リソースダッシュボード(/resource)。CR別の推定負荷率を表示する参考指標ページ
 * (ユーザー確定、2026-09-18)。既存の営業進捗(受注・完了・達成率・累計)とは
 * 完全に独立しており、それらの集計ロジックには一切触れない。
 *
 * 閲覧は経営ダッシュボードと同じ許可リスト(managementDashboardAccess)に載った
 * IAP検証済みメールのみに限定する(ユーザー確定、2026-09-18)。ナビのタブ非表示だけで
 * なく、URLを直接知っていても本文は表示しない(/managementと同じfail-closed方針)。
 */
export default async function ResourcePage() {
  const iapEmail = await getRequestIapEmail();
  const authorized = isManagementDashboardAuthorized(iapEmail);

  let resourceLoad: ResourceLoadResult | null = null;
  let loadError = false;
  if (authorized) {
    try {
      resourceLoad = await getResourceLoad();
      if (!resourceLoad) loadError = true;
    } catch {
      console.error("[resource page] 推定負荷率の取得に失敗しました");
      loadError = true;
    }
  }

  return (
    <main className="mx-auto flex max-w-5xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
      {authorized ? (
        <>
          <h1 className="text-lg font-semibold text-[var(--text-primary)] sm:text-xl">リソース</h1>
          {resourceLoad && (
            <ResourceLoadTable crLoads={resourceLoad.crLoads} anomalyCount={resourceLoad.anomalyCount} />
          )}
          {loadError && (
            <p className="text-center text-sm text-[var(--text-muted)]">
              推定負荷率のデータ取得に失敗しました。
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
  );
}
