import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getOrFetchMonthlyCashFlow } from "@/features/management-dashboard/monthlyCashFlowService";
import { verifyIapJwt } from "@/services/iap/verifyIapJwt";
import { isManagementDashboardAuthorized } from "@/config/managementDashboardAccess";

interface RefreshRequestBody {
  fiscalYear: number;
  month: number;
}

function parseRequestBody(body: unknown): RefreshRequestBody | null {
  if (typeof body !== "object" || body === null) return null;
  const { fiscalYear, month } = body as Record<string, unknown>;
  if (typeof fiscalYear !== "number" || !Number.isInteger(fiscalYear)) return null;
  if (typeof month !== "number" || !Number.isInteger(month) || month < 1 || month > 12) return null;
  return { fiscalYear, month };
}

/**
 * 指定月の月次経営スナップショットをfreeeから強制的に再取得し、Firestoreの
 * キャッシュを上書きする(「更新」ボタン用)。会計データは過去月でも修正され得るため、
 * 過去月のキャッシュを永久固定にしないための手段(ユーザー確定、2026-09-14)。
 * 認証はexchange APIと同じくIAP検証+経営ダッシュボード許可リストで絞る。
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
    const snapshot = await getOrFetchMonthlyCashFlow(parsed.fiscalYear, parsed.month, { forceRefresh: true });
    if (!snapshot) {
      return NextResponse.json({ error: "freee_not_connected" }, { status: 409 });
    }
    return NextResponse.json({ ok: true });
  } catch {
    console.error("[freee/monthly-finance/refresh] 更新に失敗しました");
    return NextResponse.json({ error: "refresh_failed" }, { status: 502 });
  }
}
