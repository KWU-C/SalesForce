const FREEE_TOKEN_ENDPOINT = "https://accounts.secure.freee.co.jp/public_api/token";
const FREEE_AUTHORIZE_ENDPOINT = "https://accounts.secure.freee.co.jp/public_api/authorize";

/**
 * freeeの認可コードグラントは、Webアプリ向けの自動リダイレクト(redirect_uri)ではなく
 * OOB(urn:ietf:wg:oauth:2.0:oob)を使う。既存の社内freee連携アプリ「TCD_freee」が
 * このredirect_uriで登録済みのため、それをそのまま再利用する(ユーザー確定、2026-09-14)。
 * このためCloud Runの実URLに依存する設定(dev/prod別のredirect_uri登録)が不要になる。
 * ユーザーはfreeeの認可画面で表示されたコードを、ダッシュボード側のフォームへ貼り付ける。
 */
const FREEE_OOB_REDIRECT_URI = "urn:ietf:wg:oauth:2.0:oob";

export interface FreeeTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
  created_at: number;
  company_id?: number;
}

function getFreeeCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.FREEE_CLIENT_ID;
  const clientSecret = process.env.FREEE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("[freeeTokenClient] FREEE_CLIENT_ID/FREEE_CLIENT_SECRETが未設定です");
  }
  return { clientId, clientSecret };
}

/** freeeの認可画面へのURL。client_idはOAuth上秘匿情報ではないため画面のリンクに使ってよい */
export function buildFreeeAuthorizeUrl(): string {
  const { clientId } = getFreeeCredentials();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: FREEE_OOB_REDIRECT_URI,
    response_type: "code",
    prompt: "select_company",
  });
  return `${FREEE_AUTHORIZE_ENDPOINT}?${params.toString()}`;
}

export async function exchangeFreeeAuthorizationCode(code: string): Promise<FreeeTokenResponse> {
  const { clientId, clientSecret } = getFreeeCredentials();
  return postFreeeToken({
    grant_type: "authorization_code",
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: FREEE_OOB_REDIRECT_URI,
  });
}

export async function refreshFreeeToken(refreshToken: string): Promise<FreeeTokenResponse> {
  const { clientId, clientSecret } = getFreeeCredentials();
  return postFreeeToken({
    grant_type: "refresh_token",
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });
}

/**
 * トークンエンドポイントのレスポンス本文にはトークン自体が含まれるため、
 * 失敗時もステータスコードのみをログに出し、本文は一切出力しない。
 */
async function postFreeeToken(params: Record<string, string>): Promise<FreeeTokenResponse> {
  const res = await fetch(FREEE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  if (!res.ok) {
    console.error(`[freeeTokenClient] トークンエンドポイントがエラーを返しました(status=${res.status})`);
    throw new Error("freee_token_exchange_failed");
  }
  return (await res.json()) as FreeeTokenResponse;
}
