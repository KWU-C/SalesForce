/**
 * Salesforce REST APIへの薄いクライアント。
 *
 * 認証はJWT Bearer Flow（対話的ログイン・パスワード不要、専用の統合ユーザー＋
 * デジタル証明書の秘密鍵を使う。docs/salesforce-integration-design.md 8節）。
 * 外部ライブラリを追加せず、Node.js標準のcrypto/fetchのみで実装する。
 *
 * アクセストークンはインスタンス内メモリでキャッシュする（Cloud Runの
 * インスタンスは複数リクエストにまたがって生存するため）。有効期限の
 * 概念がAPI応答に含まれないため、固定時間（トークン取得から25分）で
 * 失効させ再取得する（Salesforceのデフォルトセッションタイムアウトより
 * 十分短い）。
 */

import { createSign } from "node:crypto";
import type { SalesforceJwtConfig } from "@/config/salesforce";

const TOKEN_TTL_MS = 25 * 60 * 1000;

interface CachedToken {
  accessToken: string;
  instanceUrl: string;
  obtainedAt: number;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function buildJwtAssertion(config: SalesforceJwtConfig): string {
  const header = base64url(JSON.stringify({ alg: "RS256" }));
  const nowSeconds = Math.floor(Date.now() / 1000);
  const payload = base64url(
    JSON.stringify({
      iss: config.consumerKey,
      sub: config.username,
      aud: config.loginUrl,
      exp: nowSeconds + 5 * 60,
    })
  );
  const signingInput = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = base64url(signer.sign(config.privateKeyPem));
  return `${signingInput}.${signature}`;
}

/** DataSource実装がテストでフェイクを注入できるようにするための最小インターフェース */
export interface SalesforceQueryClient {
  query<T = Record<string, unknown>>(soql: string): Promise<T[]>;
}

export class SalesforceAuthError extends Error {}
export class SalesforceQueryError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

export class SalesforceClient implements SalesforceQueryClient {
  private cachedToken: CachedToken | null = null;

  constructor(private readonly config: SalesforceJwtConfig) {}

  private async getToken(): Promise<CachedToken> {
    if (this.cachedToken && Date.now() - this.cachedToken.obtainedAt < TOKEN_TTL_MS) {
      return this.cachedToken;
    }

    const assertion = buildJwtAssertion(this.config);
    const response = await fetch(`${this.config.loginUrl}/services/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
    });

    if (!response.ok) {
      // レスポンス本文にはエラー種別のみを期待するが、念のため中身は例外メッセージに含めない
      throw new SalesforceAuthError(`Salesforce認証に失敗しました (status=${response.status})`);
    }

    const body = (await response.json()) as { access_token: string; instance_url: string };
    this.cachedToken = {
      accessToken: body.access_token,
      instanceUrl: body.instance_url,
      obtainedAt: Date.now(),
    };
    return this.cachedToken;
  }

  /** SOQLクエリを実行し、レコード配列を返す（nextRecordsUrlがあれば追従する） */
  async query<T = Record<string, unknown>>(soql: string): Promise<T[]> {
    const token = await this.getToken();
    const records: T[] = [];
    let path: string | null =
      `/services/data/v${this.config.apiVersion}/query?q=${encodeURIComponent(soql)}`;

    while (path) {
      const response: Response = await fetch(`${token.instanceUrl}${path}`, {
        headers: { Authorization: `Bearer ${token.accessToken}` },
      });

      if (!response.ok) {
        throw new SalesforceQueryError(
          `Salesforce SOQLクエリに失敗しました (status=${response.status})`,
          response.status
        );
      }

      const body = (await response.json()) as {
        records: T[];
        nextRecordsUrl?: string;
        done: boolean;
      };
      records.push(...body.records);
      path = body.done ? null : (body.nextRecordsUrl ?? null);
    }

    return records;
  }
}
