import type { Metadata } from "next";
import { FreeeConnectForm } from "@/features/management-dashboard/FreeeConnectForm";
import { FinancialSummaryCards } from "@/features/management-dashboard/FinancialSummaryCards";
import type { FinancialSummarySnapshot } from "@/features/management-dashboard/financialSummary";
import { MonthlyCashFlowScrollTable } from "@/features/management-dashboard/MonthlyCashFlowScrollTable";
import type { MonthColumn } from "@/features/management-dashboard/MonthlyCashFlowScrollTable";
import { getOrFetchMonthlyCashFlow } from "@/features/management-dashboard/monthlyCashFlowService";
import type { MonthlyCashFlow } from "@/features/management-dashboard/types";
import { getOrComputeTermCashFlowTotal } from "@/features/management-dashboard/termCashFlowTotalService";
import type { TermCashFlowTotal } from "@/features/management-dashboard/termCashFlowTotal";
import { LoanStatusTable } from "@/features/management-dashboard/LoanStatusTable";
import { getOrFetchLoanStatus } from "@/features/management-dashboard/loanStatusService";
import type { LoanStatusSnapshot } from "@/features/management-dashboard/loanStatus";
import { FundReserveSection } from "@/features/management-dashboard/FundReserveSection";
import { composeFundReserve } from "@/features/management-dashboard/fundReserve";
import type { FundReserve } from "@/features/management-dashboard/fundReserve";
import { getOrFetchFundReserveCore } from "@/features/management-dashboard/fundReserveService";
import { getOrFetchFinancialSummary } from "@/features/management-dashboard/financialSummaryService";
import { getOperatingProfitTrend } from "@/features/management-dashboard/operatingProfitTrend";
import type { OperatingProfitTrendPoint } from "@/features/management-dashboard/operatingProfitTrend";
import { ManagementSummary } from "@/features/management-dashboard/ManagementSummary";
import { ExpenseCompositionSection } from "@/features/management-dashboard/ExpenseCompositionSection";
import { RefreshMonthButton } from "@/features/management-dashboard/RefreshMonthButton";
import { getRequestIapEmail } from "@/services/iap/getRequestIapEmail";
import { isManagementDashboardAuthorized } from "@/config/managementDashboardAccess";
import { getFreeeConnectionStatus } from "@/repositories/freeeAuthRepository";
import { buildFreeeAuthorizeUrl } from "@/services/freee/freeeTokenClient";
import {
  calendarYearForTermMonth,
  freeeFiscalYearForTerm,
  getCurrentFiscalPeriod,
  previousFiscalTermMonth,
} from "@/config/fiscalPeriods";
import { formatDateTime } from "@/utils/format";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "経営ダッシュボード",
  description: "TCD 経営ダッシュボード（freeeベース）",
};

/**
 * 月次資金収支の横スクロール表の起点(検証開始時の基準月＝49期8月)。ここから当月まで、
 * 月が進むごとに列が自動的に1つずつ増えていく(2ヶ月表示のレビュー後にユーザー確定、
 * 2026-09-15)。列を増やす仕組み自体はMonthlyCashFlowScrollTable側の変更を必要としない
 * (columnsの長さにそのまま追従する設計のため)。
 */
const CASH_FLOW_TABLE_ANCHOR = { term: 49, month: 8 };

/** 基準月から当月まで、事業期・暦月のペアを古い順に並べて返す(previousFiscalTermMonthを
 * 遡って辿るだけ。無限ループ防止に60ヶ月=5年分で打ち切る) */
function monthsFromAnchorToCurrent(
  anchor: { term: number; month: number },
  current: { term: number; month: number }
): { term: number; month: number }[] {
  const result: { term: number; month: number }[] = [];
  let cursor = current;
  for (let i = 0; i < 60; i++) {
    result.unshift(cursor);
    if (cursor.term === anchor.term && cursor.month === anchor.month) break;
    cursor = previousFiscalTermMonth(cursor.term, cursor.month);
  }
  return result;
}

/**
 * 経営ダッシュボード（freeeベース）。
 * 閲覧は許可リスト(managementDashboardAccess)に載ったIAP検証済みメールのみに限定する
 * （ユーザー確定、2026-09-14）。ナビのタブ非表示だけでなく、URLを直接知っていても
 * 本文は表示しない。
 *
 * 「会社版家計簿」として、会計上の利益ではなく実際の現金の動き(入金・支出・現金増減)を
 * 主役とする月次資金収支表を表示する(ユーザー確定、2026-09-14。freeeの試算表を
 * そのまま複製しない)。値は実データから取得できたものだけを表示し、取得できない項目は
 * 「データ未設定」と表示する（推測値・仮の値は一切出さない）。
 *
 * ページ全体の月切替UIは廃止し、当月は現在日付から自動判定する(ユーザー確定、2026-09-15)。
 * 経営サマリー・支出構成・借入状況・資金の備えは常に当月/現在時点を表示する
 * （月選択機能は持たせない）。月次資金収支のみ、CASH_FLOW_TABLE_ANCHOR(49期8月)〜
 * 当月までの月を横スクロール表で表示する。月が進むごとに列が自動で1つずつ増える
 * (2ヶ月表示のレビューを経てユーザー確定、2026-09-15)。
 *
 * 当月分を含む全スナップショット(月次資金収支・借入状況・資金の備え・当期累計サマリー)は
 * 常にFirestoreキャッシュ優先で読む(アクセスごとのfreeeライブ取得は行わない、ユーザー確定、
 * 2026-09-18)。ローディングを軽くするため、実際のfreee再取得は以下の2経路のみで行う:
 * Cloud SchedulerがCloud Run Admin API経由で毎日18:00(Asia/Tokyo)にトリガーする
 * Cloud Run Job(`src/jobs/scheduledFinanceRefresh.ts`。HTTPエンドポイントを持たず、
 * このWebサービスのIAP/OAuth/Cloud Run IAM設定には一切触れない)と、ヘッダーの
 * 「更新」ボタン(手動、/api/freee/monthly-finance/refresh)。両経路とも実体は
 * `refreshCurrentMonthSnapshots`を共有する(重複実装なし)。
 */
export default async function ManagementPage() {
  const iapEmail = await getRequestIapEmail();
  const authorized = isManagementDashboardAuthorized(iapEmail);

  let connectionStatus: Awaited<ReturnType<typeof getFreeeConnectionStatus>> | null = null;
  let authorizeUrl: string | null = null;
  let financialSummary: FinancialSummarySnapshot | null = null;
  let financialSummaryError = false;
  let operatingProfitTrend: OperatingProfitTrendPoint[] = [];
  let cashFlowByMonth: (MonthlyCashFlow | null)[] = [];
  let cashFlowError = false;
  let loanStatus: LoanStatusSnapshot | null = null;
  let loanStatusError = false;
  let fundReserve: FundReserve | null = null;
  let fundReserveError = false;
  const termTotalsByTerm = new Map<number, TermCashFlowTotal>();

  const { term: currentTerm, currentMonth } = getCurrentFiscalPeriod();
  const currentFiscalYear = freeeFiscalYearForTerm(currentTerm);
  const monthList = monthsFromAnchorToCurrent(CASH_FLOW_TABLE_ANCHOR, { term: currentTerm, month: currentMonth });
  // 隣接する月列でtermが変わる境目を機械的に検出する。現在は49期8月→50期9月の1箇所
  // だけだが、将来51期に入れば50期8月→51期9月の境目が新たに現れ、コード変更なしで
  // 「50期 通期」が同じ仕組みで挿入される(ユーザー確定、2026-09-18)。
  const termTotalBoundaries: number[] = [];
  for (let i = 0; i < monthList.length - 1; i++) {
    if (monthList[i].term !== monthList[i + 1].term) termTotalBoundaries.push(monthList[i].term);
  }

  if (authorized) {
    try {
      connectionStatus = await getFreeeConnectionStatus();
    } catch {
      console.error("[management page] freee接続状態の取得に失敗しました");
    }
    // FREEE_CLIENT_ID/SECRET未設定の間(Secret Manager未接続)は、連携フォームを
    // 出さず案内のみ表示する。ページ全体は落とさない(fail-safe)
    try {
      authorizeUrl = buildFreeeAuthorizeUrl();
    } catch {
      console.error("[management page] FREEE_CLIENT_ID/SECRET未設定のため連携フォームを表示しません");
    }

    if (connectionStatus?.connected) {
      // 基準月〜当月の各列を並行取得。全列ともforceRefreshせずFirestore優先で読む
      // (遅延バックフィル)。実際のfreee再取得はCloud Schedulerの定時ジョブと手動の
      // 「更新」ボタンのみが行う(ユーザー確定、2026-09-18。ページアクセス自体は
      // 常にキャッシュ読み取りのみにして毎回のローディングを軽くする)。1列の失敗が
      // 他列の表示を止めないよう、列ごとに個別にcatchする。エラーフラグは
      // Promise.all解決後にまとめて反映する(非同期コールバック内での外側変数の
      // 再代入はNext.jsのlintルールで禁止されているため)
      const cashFlowResults = await Promise.all(
        monthList.map(async (m, idx) => {
          const isCurrentMonth = idx === monthList.length - 1;
          const fy = freeeFiscalYearForTerm(m.term);
          try {
            const cashFlow = await getOrFetchMonthlyCashFlow(fy, m.month, { forceRefresh: false });
            return { cashFlow, failed: false };
          } catch (error) {
            if (isCurrentMonth) {
              // ここで出すのは自前でthrowしているエラーメッセージのみ(freee_api_error等の
              // 固定文言、トークン等の機微情報は含まない)。原因切り分けのための診断ログ
              const detail = error instanceof Error ? error.message : String(error);
              console.error(`[management page] freeeからの月次資金収支取得に失敗しました: ${detail}`);
            } else {
              console.error(`[management page] freeeからの月次資金収支取得に失敗しました(${m.term}期${m.month}月)`);
            }
            return { cashFlow: null, failed: true };
          }
        })
      );
      cashFlowByMonth = cashFlowResults.map((r) => r.cashFlow);
      cashFlowError = cashFlowResults[cashFlowResults.length - 1]?.failed ?? false;
      try {
        loanStatus = await getOrFetchLoanStatus(currentFiscalYear, currentMonth, { forceRefresh: false });
      } catch {
        console.error("[management page] freeeからの借入状況取得に失敗しました");
        loanStatusError = true;
      }
      try {
        const fundReserveCore = await getOrFetchFundReserveCore(currentFiscalYear, currentMonth, {
          forceRefresh: false,
        });
        const currentCashClosing = cashFlowByMonth[cashFlowByMonth.length - 1]?.cashClosing ?? null;
        fundReserve = fundReserveCore ? composeFundReserve(fundReserveCore, currentCashClosing) : null;
      } catch {
        console.error("[management page] freeeからの資金の備え取得に失敗しました");
        fundReserveError = true;
      }
      try {
        financialSummary = await getOrFetchFinancialSummary(currentFiscalYear, currentMonth, { forceRefresh: false });
      } catch {
        console.error("[management page] freeeからの当期累計サマリー取得に失敗しました");
        financialSummaryError = true;
      }
      // 営業利益の推移グラフ用。新たにfreeeへは取得しに行かず、上のfinancialSummary
      // (当月分)とFirestoreの過去月分キャッシュだけを読む(ユーザー確定、2026-09-22)
      try {
        operatingProfitTrend = await getOperatingProfitTrend(currentFiscalYear, currentMonth, financialSummary);
      } catch {
        console.error("[management page] 営業利益推移の取得に失敗しました");
      }
      // 期をまたぐ境目だけ通期合計(termCashFlowSnapshots)を取得する。一度計算されたら
      // Firestoreキャッシュを無条件で返す(forceRefreshは持たない、ユーザー確定、
      // 2026-09-18)ため、毎回のページアクセスで重い計算が走ることはない
      try {
        const results = await Promise.all(
          termTotalBoundaries.map(async (term) => [term, await getOrComputeTermCashFlowTotal(term)] as const)
        );
        for (const [term, total] of results) {
          if (total) termTotalsByTerm.set(term, total);
        }
      } catch {
        console.error("[management page] freeeからの通期合計取得に失敗しました");
      }
    }
  }

  // 横スクロール表(基準月〜当月)。月が進むごとに列が自動で増える(ユーザー確定、2026-09-15)。
  // 期の境目(termTotalBoundaries)には、その期の月列の直後に通期合計列を1本差し込む
  // (例: 2026年8月 | 49期 通期 | 2026年9月 当月、ユーザー確定、2026-09-18)
  const cashFlowColumns: MonthColumn[] = [];
  monthList.forEach((m, idx) => {
    cashFlowColumns.push({
      fiscalYear: freeeFiscalYearForTerm(m.term),
      term: m.term,
      month: m.month,
      calendarYear: calendarYearForTermMonth(m.term, m.month),
      isCurrent: idx === monthList.length - 1,
      cashFlow: cashFlowByMonth[idx] ?? null,
    });

    const isTermBoundary = idx < monthList.length - 1 && monthList[idx + 1].term !== m.term;
    const termTotal = isTermBoundary ? termTotalsByTerm.get(m.term) : undefined;
    if (isTermBoundary && termTotal) {
      cashFlowColumns.push({
        fiscalYear: termTotal.fiscalYear,
        term: termTotal.term,
        month: m.month,
        calendarYear: calendarYearForTermMonth(m.term, m.month),
        isCurrent: false,
        isTermTotal: true,
        cashFlow: {
          fiscalYear: termTotal.fiscalYear,
          month: m.month,
          cashOpening: termTotal.cashOpening,
          cashClosing: termTotal.cashClosing,
          cashChange: termTotal.cashChange,
          externalIncome: termTotal.externalIncome,
          externalExpenseTotal: termTotal.externalExpenseTotal,
          inflow: termTotal.inflow,
          outflow: termTotal.outflow,
          calculationVersion: termTotal.calculationVersion,
          status: termTotal.status,
          expenseByCategory: termTotal.expenseByCategory,
          operatingCashFlow: termTotal.operatingCashFlow,
          financingCashFlow: termTotal.financingCashFlow,
          interestCashFlow: termTotal.interestCashFlow,
          assetTransferCashFlow: termTotal.assetTransferCashFlow,
          fetchedAt: termTotal.computedAt,
        },
      });
    }
  });
  const currentCashFlow = cashFlowByMonth[cashFlowByMonth.length - 1] ?? null;
  const previousCashFlow = cashFlowByMonth.length > 1 ? cashFlowByMonth[cashFlowByMonth.length - 2] : null;
  // 「最終更新」表示は接続(トークン)更新時刻ではなく、当月分データが実際にfreeeから
  // 取得された時刻を示す(ユーザー確定、2026-09-18)。当月分は4スナップショットとも
  // 同じ操作(定時ジョブ/「更新」ボタン)でまとめて更新されるため、代表として
  // 月次資金収支のfetchedAtを使う。
  const dataUpdatedAt = currentCashFlow?.fetchedAt ?? null;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-10 sm:px-6">
        {authorized ? (
          <>
            <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-2">
              <h1 className="text-lg font-semibold text-[var(--text-primary)] sm:text-xl">経営ダッシュボード</h1>
              {connectionStatus?.connected && (
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  {/* 接続者メールアドレス等の長い文字列で狭幅時にページ全体が横に押し広げられない
                      よう、min-w-0(flexアイテムの既定min-width:autoを解除)と
                      overflow-wrap:anywhere(単語境界が無くても折り返す)を併用する
                      (ユーザー確定、2026-09-22。PC幅の横並び自体は変えない) */}
                  <p className="min-w-0 text-xs text-[var(--text-muted)] [overflow-wrap:anywhere]">
                    freee連携済み
                    {connectionStatus.connectedBy ? `（接続者: ${connectionStatus.connectedBy}）` : ""}
                    {dataUpdatedAt ? `／最終更新: ${formatDateTime(dataUpdatedAt)}` : ""}
                  </p>
                  <RefreshMonthButton
                    fiscalYear={currentFiscalYear}
                    month={currentMonth}
                    label="更新"
                    includeFinancialSummary
                  />
                </div>
              )}
            </div>

            {connectionStatus?.connected ? (
              <>
                <ManagementSummary
                  term={currentTerm}
                  month={currentMonth}
                  cashFlow={currentCashFlow}
                  loanStatus={loanStatus}
                  previousMonthCashClosing={previousCashFlow?.cashClosing ?? null}
                />

                {currentCashFlow && (
                  <ExpenseCompositionSection
                    expenseByCategory={currentCashFlow.expenseByCategory}
                    unclassified={currentCashFlow.outflow?.unclassified}
                    externalExpenseTotal={currentCashFlow.externalExpenseTotal}
                  />
                )}

                {cashFlowError && (
                  <p className="text-center text-sm text-[var(--text-muted)]">
                    freeeからのデータ取得に失敗しました（権限不足の場合、freeeアプリの権限設定を
                    変更した後は再接続が必要です。下記から再度お試しください）。
                  </p>
                )}

                <MonthlyCashFlowScrollTable columns={cashFlowColumns} />

                {loanStatusError && (
                  <p className="text-center text-sm text-[var(--text-muted)]">借入状況の取得に失敗しました。</p>
                )}
                {loanStatus && <LoanStatusTable loanStatus={loanStatus} />}

                {fundReserveError && (
                  <p className="text-center text-sm text-[var(--text-muted)]">資金の備えの取得に失敗しました。</p>
                )}
                {fundReserve && (
                  <FundReserveSection fundReserve={fundReserve} loanTotalCurrent={loanStatus?.totalCurrent ?? null} />
                )}

                {financialSummary && (
                  <FinancialSummaryCards
                    summary={financialSummary}
                    term={currentTerm}
                    operatingProfitTrend={operatingProfitTrend}
                  />
                )}
                {financialSummaryError && (
                  <p className="text-center text-sm text-[var(--text-muted)]">
                    当期累計データの取得に失敗しました。
                  </p>
                )}
              </>
            ) : authorizeUrl ? (
              <FreeeConnectForm authorizeUrl={authorizeUrl} mode="connect" />
            ) : (
              <p className="text-center text-sm text-[var(--text-muted)]">
                freee連携の設定が未完了です（Secret Manager未接続）。
              </p>
            )}

            {connectionStatus?.connected && authorizeUrl && (
              <FreeeConnectForm authorizeUrl={authorizeUrl} mode="reconnect" />
            )}
          </>
        ) : (
          <div className="flex flex-col gap-2 py-8 text-center">
            <h1 className="text-xl font-semibold text-[var(--text-primary)]">アクセス権がありません</h1>
            <p className="text-sm text-[var(--text-secondary)]">このページの閲覧権限がありません。</p>
          </div>
        )}
    </main>
  );
}
