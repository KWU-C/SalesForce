import { DashboardNav } from "@/components/DashboardNav";
import { getRequestIapEmail } from "@/services/iap/getRequestIapEmail";
import { isManagementDashboardAuthorized } from "@/config/managementDashboardAccess";
import { isResourceDashboardAuthorized } from "@/config/resourceDashboardAccess";

/**
 * ナビをpage.tsxのSuspense境界の外に置くためのlayout(/client-targetsと同じ構成)。
 * 注力クライアント管理タブは@tcd.jpの全ユーザー(IAP)が閲覧・編集できる(ユーザー確定、2026-10-15)。
 */
export default async function FocusClientsLayout({ children }: LayoutProps<"/focus-clients">) {
  const iapEmail = await getRequestIapEmail();
  const showManagementTab = isManagementDashboardAuthorized(iapEmail);
  const showResourceTab = isResourceDashboardAuthorized(iapEmail);

  return (
    <>
      <DashboardNav active="/focus-clients" showManagementTab={showManagementTab} showResourceTab={showResourceTab} />
      {children}
    </>
  );
}
