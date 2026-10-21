import { Firestore } from "@google-cloud/firestore";
import { resolveFirestoreDatabaseId } from "./databaseId";

/**
 * Firestore Admin SDKクライアント。認証はADC(Application Default Credentials)に
 * 委ねる（Cloud Run実行サービスアカウント／ローカルは`gcloud auth application-default
 * login`）。Google Sheets連携と同じ「ADC＋サービスアカウント偽装、JSONキー不発行」
 * の方針を踏襲し、明示的な鍵ファイルは扱わない。
 *
 * databaseIdを省略するとFirestoreは"(default)"データベースに接続する。
 * このプロジェクトでは"(default)"ではなく名前付きデータベース"dashboard"
 * （Nativeモード、asia-northeast1、2026-09-13作成）を使うため、明示的に指定する
 * （省略すると存在しない"(default)"データベースを探しにいき失敗する）。
 *
 * 接続先は環境別に FIRESTORE_DATABASE_ID で切り替える(本番=dashboard、dev2=dashboard-dev。
 * 未設定なら dashboard。databaseId.ts)。
 *
 * Cloud Runのインスタンスは複数リクエストにまたがって生存するため、
 * モジュールスコープでシングルトンとしてキャッシュする。
 */
let cachedClient: Firestore | null = null;

export function getFirestoreClient(): Firestore {
  if (!cachedClient) {
    cachedClient = new Firestore({
      databaseId: resolveFirestoreDatabaseId(),
    });
  }
  return cachedClient;
}
