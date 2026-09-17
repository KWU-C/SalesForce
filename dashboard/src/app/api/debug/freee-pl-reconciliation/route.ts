import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyIapJwt } from "@/services/iap/verifyIapJwt";
import { isManagementDashboardAuthorized } from "@/config/managementDashboardAccess";
import { getFreeeCompanyId } from "@/repositories/freeeAuthRepository";
import { getTrialPl } from "@/services/freee/freeeAccountingClient";
import { extractPlSummary } from "@/features/management-dashboard/financialSummary";
import { FISCAL_MONTH_ORDER, freeeFiscalYearForTerm } from "@/config/fiscalPeriods";

/**
 * 一時デバッグ用: 49期(2025年9月〜2026年8月)の月次PL・累計PLをfreeeのtrial_plから
 * そのまま取得し、経理報告の数値との突き合わせに使う。経営ダッシュボードのカードと
 * 同じextractPlSummary(同じ小計行の定義)を使うことで、「同じ定義で取れているか」を
 * 確認できるようにする。役目を終えたら削除する想定(ユーザー確定、2026-09-17)。
 */
export async function GET(request: NextRequest) {
  const verification = await verifyIapJwt(request.headers);
  if (!verification.ok || !isManagementDashboardAuthorized(verification.email)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const companyId = await getFreeeCompanyId();
  if (companyId === null) {
    return NextResponse.json({ error: "freee_not_connected" }, { status: 409 });
  }

  const fiscalYear = freeeFiscalYearForTerm(49);

  try {
    const [monthlyResults, totalTrialPl] = await Promise.all([
      Promise.all(
        FISCAL_MONTH_ORDER.map(async (month) => {
          const trialPl = await getTrialPl(companyId, { fiscalYear, startMonth: month, endMonth: month });
          return { month, ...extractPlSummary(trialPl) };
        })
      ),
      getTrialPl(companyId, {
        fiscalYear,
        startMonth: FISCAL_MONTH_ORDER[0],
        endMonth: FISCAL_MONTH_ORDER[FISCAL_MONTH_ORDER.length - 1],
      }),
    ]);

    return NextResponse.json({
      fiscalYear,
      monthly: monthlyResults,
      total: extractPlSummary(totalTrialPl),
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[debug/freee-pl-reconciliation] 取得に失敗しました: ${detail}`);
    return NextResponse.json({ error: "freee_api_error" }, { status: 502 });
  }
}
