/**
 * 経営ダッシュボード（/management）の閲覧を許可するメールアドレス一覧。
 * IAPで検証済みのメールアドレス（verifyIapJwtの結果）とのみ照合する
 * （クライアントから送られた値は信用しない、ユーザー確定2026-09-14）。
 */
export const MANAGEMENT_DASHBOARD_ALLOWED_EMAILS: readonly string[] = [
  "kawauchi@tcd.jp",
  "yamasaki@tcd.jp",
  "tanaka@tcd.jp",
];

export function isManagementDashboardAuthorized(email: string | null): boolean {
  if (!email) return false;
  return MANAGEMENT_DASHBOARD_ALLOWED_EMAILS.includes(email.toLowerCase());
}
