import { DashboardNav } from "@/components/DashboardNav";
import { getRequestIapEmail } from "@/services/iap/getRequestIapEmail";
import { isManagementDashboardAuthorized } from "@/config/managementDashboardAccess";
import { isResourceDashboardAuthorized } from "@/config/resourceDashboardAccess";

/**
 * ナビ(営業進捗｜勤怠｜経営)をpage.tsxのSuspense境界の外に置くためのlayout
 * (/management, /resourceと同じ構成、ユーザー確定、2026-09-24)。これにより
 * Salesforce等のデータ取得待ちでloading.tsxが表示されている間もナビは表示され続ける。
 * (home)は"/"のURLに影響しないNext.jsのルートグループ。
 */
export default async function HomeLayout({ children }: LayoutProps<"/">) {
  const iapEmail = await getRequestIapEmail();
  const showManagementTab = isManagementDashboardAuthorized(iapEmail);
  const showResourceTab = isResourceDashboardAuthorized(iapEmail);

  return (
    <>
      <DashboardNav active="/" showManagementTab={showManagementTab} showResourceTab={showResourceTab} />
      {children}
    </>
  );
}
