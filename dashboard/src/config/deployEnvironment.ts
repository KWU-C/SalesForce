/**
 * 閲覧用の正式URL(本番、ユーザーがブックマークしているもの)。
 * dev環境で本番の不具合と見間違えないよう、案内リンクに使う(ユーザー確定、2026-09-25)。
 */
export const PRODUCTION_DASHBOARD_URL = "https://tcd-dashboard-prod-807402889038.asia-northeast1.run.app";

const DEV_SERVICE_NAME = "tcd-dashboard-dev";

/**
 * Cloud Runが自動設定するK_SERVICE(サービス名)でdev環境かを判定する。
 * ローカル(next dev等)ではK_SERVICEが無いためfalseになる。
 */
export function isDevDeployment(serviceName: string | undefined = process.env.K_SERVICE): boolean {
  return serviceName === DEV_SERVICE_NAME;
}
