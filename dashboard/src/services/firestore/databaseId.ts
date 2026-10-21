/**
 * Firestoreの接続先データベース名(環境別、2026-10-21)。
 * - 本番: dashboard(コードの既定値。cloudbuild.yamlの _FIRESTORE_DATABASE_ID の既定値も同じ)
 * - dev2: dashboard-dev(dev2のビルドトリガーで指定。dev2専用サービスアカウントはこのDBだけに権限がある)
 *
 * 書き込みガード(productionDataWriteGuard)とFirestoreクライアントの両方が参照するため、
 * Firestore SDKに依存しない小さなモジュールに分けている。
 */
export const PRODUCTION_DATABASE_ID = "dashboard";

/** FIRESTORE_DATABASE_ID が未設定・空なら本番のデータベース名(従来の動作) */
export function resolveFirestoreDatabaseId(value: string | undefined = process.env.FIRESTORE_DATABASE_ID): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : PRODUCTION_DATABASE_ID;
}
