import { DashboardNav } from "@/components/DashboardNav";
import { getRequestIapEmail } from "@/services/iap/getRequestIapEmail";
import { isManagementDashboardAuthorized } from "@/config/managementDashboardAccess";

/**
 * ナビ(営業進捗｜経営｜リソース)をpage.tsxのSuspense境界の外に置くためのlayout
 * (/managementと同じ構成、ユーザー確定、2026-09-18)。リソースタブは経営タブと
 * 同じ許可リスト(kawauchi/yamasaki/tanaka@tcd.jp)で制御する(ユーザー確定)。
 */
export default async function ResourceLayout({ children }: LayoutProps<"/resource">) {
  const iapEmail = await getRequestIapEmail();
  const showRestrictedTabs = isManagementDashboardAuthorized(iapEmail);

  return (
    <>
      <DashboardNav active="/resource" showRestrictedTabs={showRestrictedTabs} />
      {children}
    </>
  );
}
