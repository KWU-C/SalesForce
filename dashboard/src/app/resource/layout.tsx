import { DashboardNav } from "@/components/DashboardNav";
import { getRequestIapEmail } from "@/services/iap/getRequestIapEmail";
import { isManagementDashboardAuthorized } from "@/config/managementDashboardAccess";
import { isResourceDashboardAuthorized } from "@/config/resourceDashboardAccess";

/**
 * ナビ(営業進捗｜勤怠｜経営)をpage.tsxのSuspense境界の外に置くためのlayout
 * (/managementと同じ構成、ユーザー確定、2026-09-18)。勤怠タブは経営タブの許可者に
 * 一部メンバーを加えた別の許可リスト(resourceDashboardAccess)で制御する(ユーザー確定、2026-09-29)。
 */
export default async function ResourceLayout({ children }: LayoutProps<"/resource">) {
  const iapEmail = await getRequestIapEmail();
  const showManagementTab = isManagementDashboardAuthorized(iapEmail);
  const showResourceTab = isResourceDashboardAuthorized(iapEmail);

  return (
    <>
      <DashboardNav active="/resource" showManagementTab={showManagementTab} showResourceTab={showResourceTab} />
      {children}
    </>
  );
}
