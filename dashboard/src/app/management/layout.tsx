import { DashboardNav } from "@/components/DashboardNav";
import { getRequestIapEmail } from "@/services/iap/getRequestIapEmail";
import { isManagementDashboardAuthorized } from "@/config/managementDashboardAccess";

/**
 * ナビ(営業進捗｜経営)をpage.tsxのSuspense境界の外に置くためのlayout。
 * これによりfreeeデータ取得待ちのloading.tsx表示中もナビが常に表示され続ける
 * (ユーザー確定、2026-09-16)。showRestrictedTabsの判定はpage.tsx側の本文表示可否
 * 判定と同じ処理だが、ナビとページ本文で別々のSuspense境界に属するため
 * (「/」ページと同様に)ここでも同じ判定をもう一度行う。IAP検証は軽量な暗号検証のみで
 * freee等の重い外部呼び出しは含まないため、ここで重複しても読み込み時間には影響しない。
 */
export default async function ManagementLayout({ children }: LayoutProps<"/management">) {
  const iapEmail = await getRequestIapEmail();
  const showRestrictedTabs = isManagementDashboardAuthorized(iapEmail);

  return (
    <>
      <DashboardNav active="/management" showRestrictedTabs={showRestrictedTabs} />
      {children}
    </>
  );
}
