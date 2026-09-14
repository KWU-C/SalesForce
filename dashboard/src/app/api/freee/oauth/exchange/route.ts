import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { connectFreeeWithAuthorizationCode } from "@/repositories/freeeAuthRepository";
import { verifyIapJwt } from "@/services/iap/verifyIapJwt";
import { isManagementDashboardAuthorized } from "@/config/managementDashboardAccess";

// freeeの認可コードは短い英数字・記号列。異常に長い入力のみ弾く簡易チェック
const CODE_MAX_LENGTH = 500;

interface ExchangeRequestBody {
  code: string;
}

function parseRequestBody(body: unknown): ExchangeRequestBody | null {
  if (typeof body !== "object" || body === null) return null;
  const { code } = body as Record<string, unknown>;
  if (typeof code !== "string" || code.length === 0 || code.length > CODE_MAX_LENGTH) return null;
  return { code };
}

/**
 * freeeの認可コード(OOBフローでユーザーが画面から貼り付けたもの)をアクセストークン・
 * リフレッシュトークンに引き換え、Firestoreへ保存するAPI。
 *
 * 認証: process-memos APIと同じくIAP JWTをサーバー側で検証し、さらに経営ダッシュボード
 * の閲覧許可リスト(managementDashboardAccess)に含まれるメールのみ許可する
 * (ユーザー確定、2026-09-14。freee接続はダッシュボード全体より機微な操作のため)。
 */
export async function POST(request: NextRequest) {
  const verification = await verifyIapJwt(request.headers);
  if (!verification.ok || !isManagementDashboardAuthorized(verification.email)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const parsed = parseRequestBody(rawBody);
  if (!parsed) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  try {
    await connectFreeeWithAuthorizationCode(parsed.code, verification.email);
    return NextResponse.json({ ok: true });
  } catch {
    // freeeのトークンエンドポイントのエラー本文にはトークン関連情報が含まれ得るため出さない
    console.error("[freee/oauth/exchange] 認可コードの引き換えに失敗しました");
    return NextResponse.json({ error: "exchange_failed" }, { status: 502 });
  }
}
