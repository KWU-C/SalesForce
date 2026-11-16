import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isManagementDashboardAuthorized } from "@/config/managementDashboardAccess";
import { parseConfirmationMonth } from "@/features/management-dashboard/accountingConfirmation";
import { saveAccountingConfirmation } from "@/repositories/accountingConfirmationRepository";
import { verifyIapJwt } from "@/services/iap/verifyIapJwt";

/**
 * 経理確認の対象月の指定API(2026-11-16)。経営タブの閲覧許可リストの人だけが使える。IAPのJWTをサーバー側で
 * 検証し、検証済みのemailを更新者に記録する。本文: { throughMonth: "YYYY-MM" | null }。月末前の月は400。
 */
export async function PUT(request: NextRequest) {
  const verification = await verifyIapJwt(request.headers);
  if (!verification.ok || !isManagementDashboardAuthorized(verification.email)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null || !("throughMonth" in body)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const throughMonth = parseConfirmationMonth((body as Record<string, unknown>).throughMonth, new Date());
  if (throughMonth === undefined) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  try {
    const saved = await saveAccountingConfirmation({ throughMonth, updatedBy: verification.email });
    return NextResponse.json({ throughMonth: saved.throughMonth });
  } catch {
    console.error("[accounting-confirmation PUT] Firestoreへの保存に失敗しました");
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
