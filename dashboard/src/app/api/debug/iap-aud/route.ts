import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * 一時的な診断用エンドポイント（IAP_EXPECTED_AUDIENCEの正しい値を確認するためだけの
 * もの。値を確認したら削除する）。
 *
 * IAPが付与するX-Goog-Iap-Jwt-Assertionのペイロードをデコードして返すだけで、
 * 署名検証は行わない（aud/issクレームは公開情報であり、読むだけなら検証は不要。
 * ここで得た値をそのまま信用する処理はどこにも無い＝実際の検証はverifyIapJwt.tsが
 * 別途IAP公開鍵で行う）。
 */
export async function GET(request: NextRequest) {
  const assertion = request.headers.get("x-goog-iap-jwt-assertion");
  if (!assertion) {
    return NextResponse.json({ error: "X-Goog-Iap-Jwt-Assertionヘッダーがありません" }, { status: 400 });
  }

  const parts = assertion.split(".");
  if (parts.length !== 3) {
    return NextResponse.json({ error: "JWTの形式が不正です" }, { status: 400 });
  }

  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8"));
    return NextResponse.json({ aud: payload.aud, iss: payload.iss });
  } catch {
    return NextResponse.json({ error: "デコードに失敗しました" }, { status: 400 });
  }
}
