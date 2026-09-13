import { Firestore } from "@google-cloud/firestore";

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
 * Cloud Runのインスタンスは複数リクエストにまたがって生存するため、
 * モジュールスコープでシングルトンとしてキャッシュする。
 */
const DEFAULT_DATABASE_ID = "dashboard";

let cachedClient: Firestore | null = null;

export function getFirestoreClient(): Firestore {
  if (!cachedClient) {
    cachedClient = new Firestore({
      databaseId: process.env.FIRESTORE_DATABASE_ID ?? DEFAULT_DATABASE_ID,
    });
  }
  return cachedClient;
}
