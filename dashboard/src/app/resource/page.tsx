import type { Metadata } from "next";
import { ResourceLoadTable } from "@/features/resource-load/ResourceLoadTable";
import { getResourceLoad } from "@/repositories/resourceLoadRepository";
import type { ResourceLoadResult } from "@/features/resource-load/resourceLoad";
import { AttendanceSection } from "@/features/attendance/AttendanceSection";
import { getAttendanceSection } from "@/repositories/attendanceRepository";
import type { AttendanceSectionData } from "@/features/attendance/attendance";
import type { AttendancePeriodView } from "@/features/attendance/AttendanceSection";
import {
  attendancePeriodKey,
  describeAttendancePeriod,
  resolveAttendancePeriod,
  selectableClosingMonths,
  todayInJapan,
} from "@/features/attendance/attendancePeriod";
import { getRequestIapEmail } from "@/services/iap/getRequestIapEmail";
import { isResourceDashboardAuthorized } from "@/config/resourceDashboardAccess";
import { isDevDeployment, PRODUCTION_DASHBOARD_URL } from "@/config/deployEnvironment";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "勤怠",
  description: "TCD 勤怠ダッシュボード（推定負荷率）",
};

/**
 * 勤怠ダッシュボード(/resource、旧称リソース)。CR別の推定負荷率(Salesforce由来)と、
 * その下に勤怠状況(freee人事労務の実績。過去28日間がデフォルト、?attendance=YYYY-MMで締め月度)を表示する参考指標ページ
 * (ユーザー確定、2026-09-18)。既存の営業進捗(受注・完了・達成率・累計)・
 * freee会計側の経営ダッシュボードの集計ロジックには一切触れない、完全に独立した機能。
 *
 * 閲覧は経営ダッシュボードと同じ許可リスト(managementDashboardAccess)に載った
 * IAP検証済みメールのみに限定する(ユーザー確定、2026-09-18)。ナビのタブ非表示だけで
 * なく、URLを直接知っていても本文は表示しない(/managementと同じfail-closed方針)。
 */
interface ResourcePageProps {
  searchParams: Promise<{ attendance?: string }>;
}

export default async function ResourcePage({ searchParams }: ResourcePageProps) {
  // 勤怠状況の表示期間。不正な値・選択肢に無い月度は過去28日間にフォールバックする
  const today = todayInJapan();
  const attendancePeriod = resolveAttendancePeriod((await searchParams).attendance, today);
  const attendancePeriodView: AttendancePeriodView = {
    ...describeAttendancePeriod(attendancePeriod, today),
    selectedKey: attendancePeriodKey(attendancePeriod),
    defaultLabel: describeAttendancePeriod({ kind: "rolling" }, today).title,
    options: selectableClosingMonths(today).map(({ key, label }) => ({ key, label })),
  };

  const iapEmail = await getRequestIapEmail();
  const authorized = isResourceDashboardAuthorized(iapEmail);

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
      attendance = await getAttendanceSection(attendancePeriod);
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
            <h1 className="text-lg font-semibold text-[var(--text-primary)] sm:text-xl">勤怠</h1>
            {resourceLoad && (
              <ResourceLoadTable crLoads={resourceLoad.crLoads} anomalyCount={resourceLoad.anomalyCount} />
            )}
            {loadError && (
              <p className="text-center text-sm text-[var(--text-muted)]">
                推定負荷率のデータ取得に失敗しました。
              </p>
            )}
          </div>

          {/* 勤怠状況の上に50px空け、区切り線を入れる(ユーザー確定、2026-09-18) */}
          <div className="mt-[50px] flex flex-col gap-6">
            <hr className="border-t border-[var(--border-hairline)]" />
            {attendance && <AttendanceSection data={attendance} period={attendancePeriodView} />}
            {/* dev環境はfreee未接続のため常に取得できない。本番の不具合と見間違えないよう
                本番URLへ案内する(ユーザー確定、2026-09-25) */}
            {attendanceError &&
              (isDevDeployment() ? (
                <p className="text-center text-sm text-[var(--text-muted)]">
                  こちらは開発環境です（freee未接続のため勤怠状況は表示されません）。閲覧ページは
                  <a
                    href={`${PRODUCTION_DASHBOARD_URL}/resource`}
                    className="text-[var(--text-primary)] underline underline-offset-2"
                  >
                    こちら
                  </a>
                  。
                </p>
              ) : (
                <p className="text-center text-sm text-[var(--text-muted)]">
                  勤怠状況のデータ取得に失敗しました。
                </p>
              ))}
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
