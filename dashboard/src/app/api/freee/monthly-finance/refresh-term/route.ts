import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getOrComputeTermCashFlowTotal } from "@/features/management-dashboard/termCashFlowTotalService";
import { verifyIapJwt } from "@/services/iap/verifyIapJwt";
import { isManagementDashboardAuthorized } from "@/config/managementDashboardAccess";

interface RefreshTermRequestBody {
  term: number;
}

function parseRequestBody(body: unknown): RefreshTermRequestBody | null {
  if (typeof body !== "object" || body === null) return null;
  const { term } = body as Record<string, unknown>;
  if (typeof term !== "number" || !Number.isInteger(term)) return null;
  return { term };
}

/**
 * 指定した事業期の通期資金収支合計(termCashFlowSnapshots)を、freeeから強制的に
 * 再取得してFirestoreを上書きする(人間による「更新」ボタン専用、ユーザー確定、
 * 2026-09-18)。通常のページアクセス・18時の定時Jobはこのルートを経由しない
 * (getOrComputeTermCashFlowTotalをforceRefreshなしで直接呼ぶだけで、一度保存された
 * 期を勝手に再計算することは無い)。認証は他のfreee系更新ルートと同じくIAP検証+
 * 経営ダッシュボード許可リストで絞る。
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
    const total = await getOrComputeTermCashFlowTotal(parsed.term, { forceRefresh: true });
    if (!total) {
      return NextResponse.json({ error: "freee_not_connected" }, { status: 409 });
    }
    return NextResponse.json({ ok: true });
  } catch {
    console.error("[freee/monthly-finance/refresh-term] 更新に失敗しました");
    return NextResponse.json({ error: "refresh_failed" }, { status: 502 });
  }
}
