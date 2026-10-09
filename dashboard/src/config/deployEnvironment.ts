/**
 * 閲覧用の正式URL(本番、ユーザーがブックマークしているもの)。
 * dev環境で本番の不具合と見間違えないよう、案内リンクに使う(ユーザー確定、2026-09-25)。
 */
export const PRODUCTION_DASHBOARD_URL = "https://tcd-dashboard-prod-807402889038.asia-northeast1.run.app";

const DEV_SERVICE_NAME = "tcd-dashboard-dev2";

/**
 * 旧dev環境のCloud Runサービス名。閲覧者が本番と取り違えてブックマークしていたため
 * (2026-10-09、古い集計条件の数値を本番の数値と見間違えた)、開発用は別サービス名
 * (DEV_SERVICE_NAME)へ移し、このサービス名のURLは本番URLへの案内ページだけを返す。
 */
const RETIRED_SERVICE_NAME = "tcd-dashboard-dev";

/**
 * Cloud Runが自動設定するK_SERVICE(サービス名)でdev環境かを判定する。
 * ローカル(next dev等)ではK_SERVICEが無いためfalseになる。
 */
export function isDevDeployment(serviceName: string | undefined = process.env.K_SERVICE): boolean {
  return serviceName === DEV_SERVICE_NAME;
}

/**
 * 廃止済みURL(旧dev環境)で動いているかを判定する。trueの場合はproxy.tsが全リクエストを
 * 案内ページ(/moved)へ差し替え、ダッシュボード本体・APIには到達させない。
 */
export function isRetiredDeployment(serviceName: string | undefined = process.env.K_SERVICE): boolean {
  return serviceName === RETIRED_SERVICE_NAME;
}
