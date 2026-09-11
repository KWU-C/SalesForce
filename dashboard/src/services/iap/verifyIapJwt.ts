import { OAuth2Client } from "google-auth-library";

/**
 * IAPが付与するX-Goog-Iap-Jwt-Assertionを検証する。
 *
 * 検証内容（google-auth-libraryのverifySignedJwtWithCertsAsyncが内部で行う）:
 * - IAP公開鍵(https://www.gstatic.com/iap/verify/public_key)による署名検証(ES256)
 * - iat/expの標準クレーム検証（期限切れ・未来すぎる有効期限を拒否）
 * - audがIAP_EXPECTED_AUDIENCEと完全一致するかの検証
 * - issuerが"https://cloud.google.com/iap"であることの検証
 *
 * IAP_EXPECTED_AUDIENCEの値はコードでは組み立てない。Cloud Runネイティブ統合時の
 * aud書式は情報源により食い違いがあり、自力で組み立てると誤った書式を検証に使って
 * しまうリスクがあるため、Google Cloud ConsoleのIAPページ（対象Cloud Runサービスの
 * 行→「Get JWT Audience Code」）で取得した値をそのまま環境変数として渡す
 * （ユーザー確定、dev/prodともIAP_EXPECTED_AUDIENCEという同じ変数名で、値は
 * 環境ごとに別々に設定する）。
 *
 * 重要: google-auth-libraryが投げる例外のmessageには検証対象のJWT本体や
 * ペイロードがそのまま含まれることがある（実装を確認済み、例:
 * "Invalid token signature: " + jwt）。そのためcatch節ではerror自体を
 * 一切ログに出さず、固定文言のみを出力する。
 */

export type IapVerificationFailureReason = "missing_config" | "missing_header" | "verification_failed";

export type IapVerificationResult =
  | { ok: true; email: string }
  | { ok: false; reason: IapVerificationFailureReason };

const IAP_ASSERTION_HEADER = "x-goog-iap-jwt-assertion";
const IAP_ISSUER = "https://cloud.google.com/iap";

const oAuth2Client = new OAuth2Client();

export async function verifyIapJwt(headers: Headers): Promise<IapVerificationResult> {
  const expectedAudience = process.env.IAP_EXPECTED_AUDIENCE;
  if (!expectedAudience) {
    console.error("[verifyIapJwt] IAP_EXPECTED_AUDIENCE未設定のため書き込みAPIを拒否します(fail-closed)");
    return { ok: false, reason: "missing_config" };
  }

  const assertion = headers.get(IAP_ASSERTION_HEADER);
  if (!assertion) {
    console.error("[verifyIapJwt] X-Goog-Iap-Jwt-Assertionヘッダーがありません(category=missing_header)");
    return { ok: false, reason: "missing_header" };
  }

  try {
    const { pubkeys } = await oAuth2Client.getIapPublicKeys();
    const ticket = await oAuth2Client.verifySignedJwtWithCertsAsync(assertion, pubkeys, expectedAudience, [
      IAP_ISSUER,
    ]);
    const email = ticket.getPayload()?.email;
    if (!email) {
      console.error("[verifyIapJwt] 検証済みJWTにemailクレームがありません");
      return { ok: false, reason: "verification_failed" };
    }
    return { ok: true, email };
  } catch {
    // 例外オブジェクト・メッセージにJWT本体が含まれ得るため、内容は一切ログに出さない
    console.error("[verifyIapJwt] JWT検証に失敗しました(category=verification_failed)");
    return { ok: false, reason: "verification_failed" };
  }
}
