import { MANAGEMENT_DASHBOARD_ALLOWED_EMAILS } from "./managementDashboardAccess";

/**
 * 勤怠ダッシュボード(/resource)の閲覧を許可するメールアドレス一覧。
 * 経営ダッシュボードの許可者に加え、勤怠タブのみ閲覧できるメンバーを追加する
 * (ユーザー確定、2026-09-29)。経営タブ・freee関連APIの許可範囲は広げない。
 * IAPで検証済みのメールアドレス(verifyIapJwtの結果)とのみ照合する。
 */
export const RESOURCE_DASHBOARD_ALLOWED_EMAILS: readonly string[] = [
  ...MANAGEMENT_DASHBOARD_ALLOWED_EMAILS,
  "yamamoto.miki@tcd.jp",
  "kamao@tcd.jp",
  "nonaka@tcd.jp",
];

export function isResourceDashboardAuthorized(email: string | null): boolean {
  if (!email) return false;
  return RESOURCE_DASHBOARD_ALLOWED_EMAILS.includes(email.toLowerCase());
}
