import type { Metadata } from "next";
import { ResourceLoadTable } from "@/features/resource-load/ResourceLoadTable";
import { getResourceLoad } from "@/repositories/resourceLoadRepository";
import type { ResourceLoadResult } from "@/features/resource-load/resourceLoad";
import { AttendanceSection } from "@/features/attendance/AttendanceSection";
import { getAttendanceSection } from "@/repositories/attendanceRepository";
import type { AttendanceSectionData } from "@/features/attendance/attendance";
import { getRequestIapEmail } from "@/services/iap/getRequestIapEmail";
import { isManagementDashboardAuthorized } from "@/config/managementDashboardAccess";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "リソース",
  description: "TCD リソースダッシュボード（推定負荷率）",
};

/**
 * リソースダッシュボード(/resource)。CR別の推定負荷率(Salesforce由来)と、
 * その下に勤怠状況(freee人事労務の当月実績)を表示する参考指標ページ
 * (ユーザー確定、2026-09-18)。既存の営業進捗(受注・完了・達成率・累計)・
 * freee会計側の経営ダッシュボードの集計ロジックには一切触れない、完全に独立した機能。
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
  let attendance: AttendanceSectionData | null = null;
  let attendanceError = false;
  if (authorized) {
    try {
      resourceLoad = await getResourceLoad();
      if (!resourceLoad) loadError = true;
    } catch {
      console.error("[resource page] 推定負荷率の取得に失敗しました");
      loadError = true;
    }
    try {
      attendance = await getAttendanceSection();
      if (!attendance) attendanceError = true;
    } catch {
      console.error("[resource page] 勤怠状況の取得に失敗しました");
      attendanceError = true;
    }
  }

  return (
    <main className="mx-auto flex max-w-5xl flex-1 flex-col px-4 py-10 sm:px-6">
      {authorized ? (
        <>
          <div className="flex flex-col gap-6">
            <h1 className="text-lg font-semibold text-[var(--text-primary)] sm:text-xl">リソース</h1>
            {resourceLoad && (
              <ResourceLoadTable crLoads={resourceLoad.crLoads} anomalyCount={resourceLoad.anomalyCount} />
            )}
            {loadError && (
              <p className="text-center text-sm text-[var(--text-muted)]">
                推定負荷率のデータ取得に失敗しました。
              </p>
            )}
          </div>

          {/* 勤怠状況の上に50px空ける(ユーザー確定、2026-09-18) */}
          <div className="mt-[50px] flex flex-col gap-6">
            {attendance && <AttendanceSection data={attendance} />}
            {attendanceError && (
              <p className="text-center text-sm text-[var(--text-muted)]">
                勤怠状況のデータ取得に失敗しました。
              </p>
            )}
          </div>
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
