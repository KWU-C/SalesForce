import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  EDITABLE_TEXT_FIELDS,
  FocusClientNotFoundError,
  saveFocusClient,
} from "@/repositories/focusClientMasterRepository";
import type { EditableTextField, SaveFocusClientInput } from "@/repositories/focusClientMasterRepository";
import { isSalesforceId } from "@/services/salesforce/focusClientQueries";
import { verifyIapJwt } from "@/services/iap/verifyIapJwt";

const TEXT_MAX_LENGTH = 2000;

type ParsedBody = Omit<SaveFocusClientInput, "accountId" | "updatedBy">;

/**
 * fieldsは編集可能なテキスト項目の部分集合(1項目以上)。未知のキーを含む要求は拒否する。
 * 区分・担当・テーマ・目標はSalesforce取引先が正のため受け付けない(ユーザー確定 2026-10-30)。
 */
function parseRequestBody(body: unknown): ParsedBody | null {
  if (typeof body !== "object" || body === null) return null;
  const { fields, ...rest } = body as Record<string, unknown>;
  if (Object.keys(rest).length > 0) return null;
  if (typeof fields !== "object" || fields === null) return null;
  const result: ParsedBody = { fields: {} };
  for (const [key, value] of Object.entries(fields)) {
    if (!(EDITABLE_TEXT_FIELDS as readonly string[]).includes(key)) return null;
    if (typeof value !== "string" || value.length > TEXT_MAX_LENGTH) return null;
    result.fields[key as EditableTextField] = value;
  }
  if (Object.keys(result.fields).length === 0) return null;
  return result;
}

/**
 * 注力クライアントのダッシュボード側項目(営業戦略・状況・アクション・メモ)の更新API。
 * Salesforceで注力・掘り起こしになっていない取引先は404。@tcd.jpの全閲覧者が編集できる(ユーザー確定、2026-10-15)。
 * 認証は案件メモAPI(/api/process-memos)と同じく、IAPのJWTをサーバー側で検証し、
 * 検証済みのemailだけをupdatedByに使う。検証失敗は理由を問わず403のみを返す。
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await params;
  if (!isSalesforceId(accountId)) {
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
    const saved = await saveFocusClient({ accountId, updatedBy: verification.email, ...parsed });
    return NextResponse.json(saved);
  } catch (error) {
    if (error instanceof FocusClientNotFoundError) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    console.error("[focus-clients PUT] 保存に失敗しました");
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
