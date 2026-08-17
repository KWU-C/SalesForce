/**
 * Salesforce連携の設定。
 *
 * 認証情報（Consumer Key・秘密鍵等）はコードに書かず環境変数から解決する。
 * ローカル開発では秘密鍵ファイルのパス（SALESFORCE_PRIVATE_KEY_PATH）を、
 * 本番（Cloud Run + Secret Manager）では鍵本体（SALESFORCE_PRIVATE_KEY）を
 * 環境変数で渡す想定（docs/salesforce-integration-design.md 8節参照）。
 */

import { readFileSync } from "node:fs";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `環境変数 ${name} が未設定です。docs/salesforce-integration-design.md 9節を参照し設定してください。`
    );
  }
  return value;
}

export interface SalesforceJwtConfig {
  /** OAuth JWT Bearer Flowのトークンエンドポイント基点（例: https://tcd-company.my.salesforce.com） */
  loginUrl: string;
  /** 外部クライアントアプリのコンシューマーキー（Client ID） */
  consumerKey: string;
  /** 統合ユーザーのユーザー名 */
  username: string;
  /** JWT署名用の秘密鍵（PEM形式） */
  privateKeyPem: string;
  /** REST APIのバージョン（例: 61.0） */
  apiVersion: string;
}

export function getSalesforceJwtConfig(): SalesforceJwtConfig {
  const privateKeyPem = process.env.SALESFORCE_PRIVATE_KEY
    ? process.env.SALESFORCE_PRIVATE_KEY
    : readFileSync(requireEnv("SALESFORCE_PRIVATE_KEY_PATH"), "utf-8");

  return {
    loginUrl: requireEnv("SALESFORCE_LOGIN_URL"),
    consumerKey: requireEnv("SALESFORCE_CONSUMER_KEY"),
    username: requireEnv("SALESFORCE_USERNAME"),
    privateKeyPem,
    apiVersion: process.env.SALESFORCE_API_VERSION ?? "61.0",
  };
}
