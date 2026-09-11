import { Firestore } from "@google-cloud/firestore";

/**
 * Firestore Admin SDKクライアント。認証はADC(Application Default Credentials)に
 * 委ねる（Cloud Run実行サービスアカウント／ローカルは`gcloud auth application-default
 * login`）。Google Sheets連携と同じ「ADC＋サービスアカウント偽装、JSONキー不発行」
 * の方針を踏襲し、明示的な鍵ファイルは扱わない。
 *
 * Cloud Runのインスタンスは複数リクエストにまたがって生存するため、
 * モジュールスコープでシングルトンとしてキャッシュする。
 */
let cachedClient: Firestore | null = null;

export function getFirestoreClient(): Firestore {
  if (!cachedClient) {
    cachedClient = new Firestore();
  }
  return cachedClient;
}
