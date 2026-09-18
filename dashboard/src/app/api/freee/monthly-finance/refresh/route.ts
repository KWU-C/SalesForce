import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { refreshCurrentMonthSnapshots } from "@/features/management-dashboard/refreshCurrentMonthSnapshots";
import { verifyIapJwt } from "@/services/iap/verifyIapJwt";
import { isManagementDashboardAuthorized } from "@/config/managementDashboardAccess";

interface RefreshRequestBody {
  fiscalYear: number;
  month: number;
  /** 当期累計サマリー(financialSummarySnapshots)も併せて再取得するか。省略時false
   * (過去月の資金収支だけを直したい場合に、常に「当期累計」を指す当期サマリーまで
   * 無条件で叩き直さないため、ユーザー確定、2026-09-18) */
  includeFinancialSummary?: boolean;
}

function parseRequestBody(body: unknown): RefreshRequestBody | null {
  if (typeof body !== "object" || body === null) return null;
  const { fiscalYear, month, includeFinancialSummary } = body as Record<string, unknown>;
  if (typeof fiscalYear !== "number" || !Number.isInteger(fiscalYear)) return null;
  if (typeof month !== "number" || !Number.isInteger(month) || month < 1 || month > 12) return null;
  if (includeFinancialSummary !== undefined && typeof includeFinancialSummary !== "boolean") return null;
  return { fiscalYear, month, includeFinancialSummary: includeFinancialSummary ?? false };
}

/**
 * 指定月の月次経営スナップショット(月次資金収支・借入状況・資金の備え。
 * includeFinancialSummary=trueなら当期累計サマリーも)をまとめてfreeeから強制的に
 * 再取得し、Firestoreのキャッシュを上書きする(人間による「更新」ボタン用)。
 * 会計データは過去月でも修正され得るため、過去月のキャッシュを永久固定にしない
 * ための手段(ユーザー確定、2026-09-14。3種のスナップショットに拡張、2026-09-15。
 * 当期累計サマリーの併せ更新に対応、2026-09-18)。
 *
 * 実際の取得・保存処理は`refreshCurrentMonthSnapshots`に切り出しており、毎日18:00に
 * 当月分を自動更新するCloud Run Job(`src/jobs/scheduledFinanceRefresh.ts`)と同じ実装を
 * 使う(重複実装を避けるため、ユーザー確定、2026-09-18。定時実行はIAPを経由しない
 * Cloud Run Jobに一本化したため、以前あったIAP経由の定時更新用エンドポイントは
 * 廃止した)。認証はexchange APIと同じくIAP検証+経営ダッシュボード許可リストで絞る
 * (この許可リストはこのルート専用。Jobは別経路のため対象外)。
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
    const { connected } = await refreshCurrentMonthSnapshots(parsed.fiscalYear, parsed.month, {
      includeFinancialSummary: parsed.includeFinancialSummary,
    });
    if (!connected) {
      return NextResponse.json({ error: "freee_not_connected" }, { status: 409 });
    }
    return NextResponse.json({ ok: true });
  } catch {
    console.error("[freee/monthly-finance/refresh] 更新に失敗しました");
    return NextResponse.json({ error: "refresh_failed" }, { status: 502 });
  }
}
