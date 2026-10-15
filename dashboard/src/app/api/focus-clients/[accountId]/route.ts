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
/** 目標額の上限(誤入力対策。1兆円) */
const AMOUNT_MAX = 1_000_000_000_000;

function parseAmount(value: unknown): number | null | undefined {
  if (value === null) return null;
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= AMOUNT_MAX) return value;
  return undefined;
}

type ParsedBody = Omit<SaveFocusClientInput, "accountId" | "updatedBy">;

/**
 * fieldsは編集可能なテキスト項目の部分集合、targetは{term, sales, grossProfit}(金額は0以上の整数かnull)。
 * どちらも省略可能だが、少なくとも一方は必要。未知のキーを含む要求は拒否する。
 */
function parseRequestBody(body: unknown): ParsedBody | null {
  if (typeof body !== "object" || body === null) return null;
  const { fields, target } = body as Record<string, unknown>;
  const result: ParsedBody = { fields: {} };

  if (fields !== undefined) {
    if (typeof fields !== "object" || fields === null) return null;
    for (const [key, value] of Object.entries(fields)) {
      if (!(EDITABLE_TEXT_FIELDS as readonly string[]).includes(key)) return null;
      if (typeof value !== "string" || value.length > TEXT_MAX_LENGTH) return null;
      result.fields[key as EditableTextField] = value;
    }
  }

  if (target !== undefined) {
    if (typeof target !== "object" || target === null) return null;
    const { term, sales, grossProfit } = target as Record<string, unknown>;
    if (typeof term !== "number" || !Number.isInteger(term) || term < 1 || term > 999) return null;
    const parsedSales = parseAmount(sales);
    const parsedGrossProfit = parseAmount(grossProfit);
    if (parsedSales === undefined || parsedGrossProfit === undefined) return null;
    result.target = { term, sales: parsedSales, grossProfit: parsedGrossProfit };
  }

  if (Object.keys(result.fields).length === 0 && !result.target) return null;
  return result;
}

/**
 * 注力クライアントマスタの更新API。@tcd.jpの全閲覧者が編集できる(ユーザー確定、2026-10-15)。
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
    console.error("[focus-clients PUT] Firestoreへの保存に失敗しました");
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
