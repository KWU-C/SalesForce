import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyIapJwt } from "@/services/iap/verifyIapJwt";
import { isManagementDashboardAuthorized } from "@/config/managementDashboardAccess";
import { getFreeeCompanyId } from "@/repositories/freeeAuthRepository";
import { getTrialPl } from "@/services/freee/freeeAccountingClient";
import { extractPlSummary } from "@/features/management-dashboard/financialSummary";
import { FISCAL_MONTH_ORDER, freeeFiscalYearForTerm, fiscalTermDateRange } from "@/config/fiscalPeriods";
import { getDeals, getAccountItems } from "@/services/freee/freeeTransactionClient";

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

  const mode = request.nextUrl.searchParams.get("mode");

  if (mode === "find-entry") {
    // 収入取引(type=income)を49期全体で取得し、明細合計が指定額に一致するものを探す
    // (9/16→9/17に追加/修正された可能性のある仕訳を特定するため、2026-09-17)。
    const amountParam = request.nextUrl.searchParams.get("amount");
    const targetAmount = amountParam ? Number(amountParam) : 1670000;
    const { start, end } = fiscalTermDateRange(49);
    try {
      const [incomeDeals, accountItems] = await Promise.all([
        getDeals(companyId, "income", start, end),
        getAccountItems(companyId),
      ]);
      const idToName = new Map(accountItems.map((i) => [i.id, i.name]));
      const matches = incomeDeals
        .map((deal) => ({
          id: deal.id,
          issueDate: deal.issue_date,
          total: deal.details.reduce((s, d) => s + d.amount, 0),
          details: deal.details.map((d) => ({
            accountItem: idToName.get(d.account_item_id) ?? `id:${d.account_item_id}`,
            amount: d.amount,
          })),
        }))
        .filter((d) => d.total === targetAmount);
      return NextResponse.json({
        targetAmount,
        dateRange: { start, end },
        totalIncomeDealsScanned: incomeDeals.length,
        matches,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error(`[debug/freee-pl-reconciliation] find-entry失敗: ${detail}`);
      return NextResponse.json({ error: "freee_api_error" }, { status: 502 });
    }
  }

  const fiscalYear = freeeFiscalYearForTerm(49);

  try {
    // freeeのレート制限に引っかかるため並列ではなく直列で呼ぶ(実データで429を確認、2026-09-17)
    const monthlyResults = [];
    for (const month of FISCAL_MONTH_ORDER) {
      const trialPl = await getTrialPl(companyId, { fiscalYear, startMonth: month, endMonth: month });
      monthlyResults.push({ month, ...extractPlSummary(trialPl) });
    }
    const totalTrialPl = await getTrialPl(companyId, {
      fiscalYear,
      startMonth: FISCAL_MONTH_ORDER[0],
      endMonth: FISCAL_MONTH_ORDER[FISCAL_MONTH_ORDER.length - 1],
    });
    // 経営ダッシュボードのFinancialSummaryCardsと全く同じ呼び出し(引数なし=freeeの
    // 「現在の会計年度」のデフォルト挙動に委ねる)。ここが49期通期と一致するかどうかで、
    // 本番カードが今どの期間を指しているかを確認する。
    const liveCardTrialPl = await getTrialPl(companyId);

    return NextResponse.json({
      fiscalYear,
      monthly: monthlyResults,
      total: extractPlSummary(totalTrialPl),
      liveManagementCard: extractPlSummary(liveCardTrialPl),
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[debug/freee-pl-reconciliation] 取得に失敗しました: ${detail}`);
    return NextResponse.json({ error: "freee_api_error" }, { status: 502 });
  }
}
