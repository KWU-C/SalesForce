import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getOrFetchMonthlyCashFlow } from "@/features/management-dashboard/monthlyCashFlowService";
import { getOrFetchLoanStatus } from "@/features/management-dashboard/loanStatusService";
import { getOrFetchFundReserveCore } from "@/features/management-dashboard/fundReserveService";
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
 * 指定月の月次経営スナップショット(月次資金収支・借入状況・資金の備え)を
 * まとめてfreeeから強制的に再取得し、Firestoreのキャッシュを上書きする
 * (「更新」ボタン用)。会計データは過去月でも修正され得るため、過去月のキャッシュを
 * 永久固定にしないための手段(ユーザー確定、2026-09-14。3種のスナップショットに
 * 拡張、2026-09-15)。認証はexchange APIと同じくIAP検証+経営ダッシュボード許可リストで絞る。
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
    const [cashFlow, loanStatus, fundReserveCore] = await Promise.all([
      getOrFetchMonthlyCashFlow(parsed.fiscalYear, parsed.month, { forceRefresh: true }),
      getOrFetchLoanStatus(parsed.fiscalYear, parsed.month, { forceRefresh: true }),
      getOrFetchFundReserveCore(parsed.fiscalYear, parsed.month, { forceRefresh: true }),
    ]);
    if (!cashFlow || !loanStatus || !fundReserveCore) {
      return NextResponse.json({ error: "freee_not_connected" }, { status: 409 });
    }
    return NextResponse.json({ ok: true });
  } catch {
    console.error("[freee/monthly-finance/refresh] 更新に失敗しました");
    return NextResponse.json({ error: "refresh_failed" }, { status: 502 });
  }
}
