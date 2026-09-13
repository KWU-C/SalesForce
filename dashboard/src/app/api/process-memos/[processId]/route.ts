import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isConcreteCrId } from "@/domain/types";
import type { ConcreteCrId } from "@/domain/types";
import { saveProcessMemo } from "@/repositories/processMemoRepository";
import { verifyIapJwt } from "@/services/iap/verifyIapJwt";

// SalesforceのIdは15桁または18桁の英数字（案件名等と違いURLセグメントとして安全な文字集合）
const PROCESS_ID_PATTERN = /^[a-zA-Z0-9]{15,18}$/;
const MEMO_MAX_LENGTH = 2000;

interface SaveMemoRequestBody {
  crId: ConcreteCrId;
  memo?: string;
  highlighted?: boolean;
}

/**
 * memo/highlightedはどちらも省略可能（片方だけの更新に対応、
 * processMemoRepository.tsのマージ書き込み参照）だが、少なくとも
 * 一方は指定されている必要がある（何も更新しない要求は拒否する）。
 */
function parseRequestBody(body: unknown): SaveMemoRequestBody | null {
  if (typeof body !== "object" || body === null) return null;
  const { crId, memo, highlighted } = body as Record<string, unknown>;
  if (!isConcreteCrId(crId)) return null;
  if (memo !== undefined && (typeof memo !== "string" || memo.length > MEMO_MAX_LENGTH)) return null;
  if (highlighted !== undefined && typeof highlighted !== "boolean") return null;
  if (memo === undefined && highlighted === undefined) return null;
  return { crId, memo, highlighted };
}

/**
 * ダッシュボード独自メモの保存API。
 *
 * 認証: IAPが付与するX-Goog-Iap-Jwt-Assertionをサーバー側で検証し(verifyIapJwt)、
 * 検証済みJWT内のemailのみをupdatedByに使う。クライアントが送ってきたemailは
 * 一切信用しない(リクエストボディにemailフィールド自体を設けていない)。
 * 検証に失敗した場合は理由を問わず403のみを返し、詳細はレスポンスに含めない。
 *
 * ダッシュボード本体の閲覧(page.tsx側のSSR)はこのAPIと独立しているため、
 * IAP_EXPECTED_AUDIENCE未設定でもこのAPIが403を返すだけで、閲覧自体は止まらない。
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ processId: string }> }) {
  const { processId } = await params;
  if (!PROCESS_ID_PATTERN.test(processId)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const verification = await verifyIapJwt(request.headers);
  if (!verification.ok) {
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
    const saved = await saveProcessMemo({
      processId,
      crId: parsed.crId,
      memo: parsed.memo,
      highlighted: parsed.highlighted,
      updatedBy: verification.email,
    });
    return NextResponse.json(saved);
  } catch {
    console.error("[process-memos PUT] Firestoreへの保存に失敗しました");
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
