import { DashboardNav } from "@/components/DashboardNav";
import { getRequestIapEmail } from "@/services/iap/getRequestIapEmail";
import { isManagementDashboardAuthorized } from "@/config/managementDashboardAccess";
import { isResourceDashboardAuthorized } from "@/config/resourceDashboardAccess";

/**
 * ナビをpage.tsxのSuspense境界の外に置くためのlayout((home)・/resource・/managementと同じ構成)。
 * クライアント別目標タブ自体は営業進捗タブと同じく@tcd.jpの全ユーザー(IAP)が閲覧でき、
 * ページ側の追加の許可リストは持たない(ユーザー確定、2026-10-14)。
 */
export default async function ClientTargetsLayout({ children }: LayoutProps<"/client-targets">) {
  const iapEmail = await getRequestIapEmail();
  const showManagementTab = isManagementDashboardAuthorized(iapEmail);
  const showResourceTab = isResourceDashboardAuthorized(iapEmail);

  return (
    <>
      <DashboardNav active="/client-targets" showManagementTab={showManagementTab} showResourceTab={showResourceTab} />
      {children}
    </>
  );
}
