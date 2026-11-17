import type { Metadata } from "next";
import { FreeeConnectForm } from "@/features/management-dashboard/FreeeConnectForm";
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
import { getLoanStatusSnapshot } from "@/repositories/loanStatusSnapshotRepository";
import type { FundReserve } from "@/features/management-dashboard/fundReserve";
import { getOrFetchFundReserveCore } from "@/features/management-dashboard/fundReserveService";
import { getOrFetchTermMonthlyPl, termMonthsThrough } from "@/features/management-dashboard/monthlyPlService";
import {
  FULL_TERM_LAST_MONTH,
  getOrFetchTermPerformance,
  getStoredTermPerformance,
} from "@/features/management-dashboard/monthlyPerformanceService";
import type { MonthlyPerformanceSnapshot } from "@/features/management-dashboard/monthlyPerformance";
import type { PerformanceMonth } from "@/features/management-dashboard/performanceView";
import {
  MonthlyPerformanceSection,
  latestFetchedAt,
} from "@/features/management-dashboard/MonthlyPerformanceSection";
import { CostStructureSection } from "@/features/management-dashboard/CostStructureSection";
import { SectionBanner } from "@/features/management-dashboard/SectionBanner";
import { ManagementSummary } from "@/features/management-dashboard/ManagementSummary";
import { ManagementTabs } from "@/features/management-dashboard/ManagementTabs";
import { PerformanceSummaryBand, PreviousMonthEndBalance } from "@/features/management-dashboard/OverviewSections";
import {
  monthsAfter,
  resolveSummaryBasis,
  previousMonthInJst,
  summarizePerformanceColumn,
  summarizePreviousMonthCash,
  summarizePreviousMonthLoans,
  targetMonth,
} from "@/features/management-dashboard/overviewComparison";
import {
  OverviewLinks,
  OverviewNotice,
} from "@/features/management-dashboard/ManagementOverview";
import { ExpenseCompositionSection } from "@/features/management-dashboard/ExpenseCompositionSection";
import { RefreshMonthButton } from "@/features/management-dashboard/RefreshMonthButton";
import { AccountingConfirmationForm } from "@/features/management-dashboard/AccountingConfirmationForm";
import type { AccountingConfirmation } from "@/features/management-dashboard/accountingConfirmation";
import { getAccountingConfirmation } from "@/repositories/accountingConfirmationRepository";
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
import { ReferenceCashForecastSection, ReferencePlSection } from "@/features/management-dashboard/ReferenceForecastSections";
import type { ReferenceForecastRecord } from "@/features/management-dashboard/referenceForecast";
import { getLatestReferenceForecast } from "@/repositories/referenceForecastRepository";

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
 *
 * freee接続済みの本文は「概要/業績・採算/財務・資金繰り/入出金明細」の4タブに分ける(2026-11-13、閲覧構成の
 * 整理。取得項目・計算式・対象期間は変えない)。タブの中身はここ(サーバー)で組み立てて渡し、タブ切替は
 * クライアントでの表示切替だけにする。未接続時は従来どおり接続フォームと資金繰り見通しだけを出す。
 * 再接続の導線はタブの外(本文の最下部)に置き、どのタブからでも使えるようにする。
 */
export default async function ManagementPage() {
  const iapEmail = await getRequestIapEmail();
  const authorized = isManagementDashboardAuthorized(iapEmail);

  let connectionStatus: Awaited<ReturnType<typeof getFreeeConnectionStatus>> | null = null;
  let authorizeUrl: string | null = null;
  let currentPerformance: (MonthlyPerformanceSnapshot | null)[] | null = null;
  let previousPerformance: (MonthlyPerformanceSnapshot | null)[] | null = null;
  let performanceError = false;
  // 概要「経理調整済みの累計」が前期の月になったとき(9月に開いた・当期に調整済みの月が無い)の前年同期に要る、
  // 前々期の保存済み月次業績(Firestoreのみ)
  let twoTermsAgoPerformance: (MonthlyPerformanceSnapshot | null)[] = [];
  let twoTermsAgoPerformanceError = false;
  // 経理確認の対象月(概要上段の累計の最終月の指定)。読めなければ暫定の仕掛品振替判定で出す
  let accountingConfirmation: AccountingConfirmation | null = null;
  let referenceForecast: ReferenceForecastRecord | null = null;
  let accountingConfirmationError = false;
  let cashFlowByMonth: (MonthlyCashFlow | null)[] = [];
  let cashFlowError = false;
  let loanStatus: LoanStatusSnapshot | null = null;
  let loanStatusError = false;
  // 前月末の借入残高(概要「資金残高（前月末実績）」)。保存済みの値を読むだけでfreeeは呼ばない
  let previousMonthLoanSnapshot: LoanStatusSnapshot | null = null;
  let fundReserve: FundReserve | null = null;
  let fundReserveError = false;
  const termTotalsByTerm = new Map<number, TermCashFlowTotal>();

  const { term: currentTerm, currentMonth } = getCurrentFiscalPeriod();
  const now = new Date();
  // 概要「前月末までの実績」の対象月(日本時間の前月)
  const previousMonthTarget = previousMonthInJst(now);
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
    // 経理の資金繰り予定(PDFからの登録値)は2026-11-16に画面から外した(ユーザー指定: PDFは照合専用で、算出・表示に
    // 使わない)。Firestoreのデータは残す
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
      // 準備額・当座貸越枠・担保控除額(手入力の管理値)は2026-11-16から読まない(ユーザー指定: 手入力の金額を算出に使わない)
      try {
        previousMonthLoanSnapshot = await getLoanStatusSnapshot(previousMonthTarget.fiscalYear, previousMonthTarget.month);
      } catch {
        console.error("[management page] 前月末の借入状況の読み込みに失敗しました");
      }
      try {
        const fundReserveCore = await getOrFetchFundReserveCore(currentFiscalYear, currentMonth, {
          forceRefresh: false,
        });
        const currentCashClosing = cashFlowByMonth[cashFlowByMonth.length - 1]?.cashClosing ?? null;
        fundReserve = fundReserveCore
          ? composeFundReserve(fundReserveCore, {
              cash: currentCashClosing,
              // 資金余力は表示しないので、手入力の準備額・当座貸越の利用額は渡さない
              settings: null,
              loanTotal: loanStatus?.totalCurrent ?? null,
              overdraftUsed: null,
            })
          : null;
      } catch {
        console.error("[management page] freeeからの資金の備え取得に失敗しました");
        fundReserveError = true;
      }
      // 月次業績・採算(②③と経営サマリー、ユーザー確定 2026-10-27)。当期は期首〜当月で、保存済みの月は
      // Firestoreのみを読み、未保存の月(月替わり直後の新しい月)だけfreeeから取得する。前期はFirestoreだけを読み、
      // 画面表示ではfreeeを呼ばない(未保存の月は定時更新・「更新」ボタンが取得する。それまでは前年同期を未取得と表示)
      try {
        currentPerformance = await getOrFetchTermPerformance(currentFiscalYear, currentMonth);
        previousPerformance = await getStoredTermPerformance(currentFiscalYear - 1, FULL_TERM_LAST_MONTH);
      } catch {
        console.error("[management page] 月次業績・採算の取得に失敗しました");
        performanceError = true;
      }
      // 経理調整済みの累計が前期の月になることがある(9月に開いた・当期の調整前)ので、その前年同期にあたる前々期も
      // 読む。保存済みの値を読むだけでfreeeは呼ばない
      try {
        twoTermsAgoPerformance = await getStoredTermPerformance(currentFiscalYear - 2, FULL_TERM_LAST_MONTH);
      } catch {
        console.error("[management page] 前々期の月次業績の読み込みに失敗しました");
        twoTermsAgoPerformanceError = true;
      }
      // 資金・損益の参考予測(DEVのみ。本番のデータベースでは読まずにnull)。読めなくても他の表示は止めない
      try {
        referenceForecast = await getLatestReferenceForecast();
      } catch {
        console.error("[management page] 参考予測の読み込みに失敗しました");
      }
      try {
        accountingConfirmation = await getAccountingConfirmation();
      } catch {
        console.error("[management page] 経理確認の対象月の読み込みに失敗しました");
        accountingConfirmationError = true;
      }
      // 月次P/L(monthlyPlSnapshots)は経理月次報告・資金繰り見通しのfreee比較に使う。画面のグラフは
      // 月次業績の推移へ置き換えたが、当月分の遅延取得は従来どおり行う
      try {
        await getOrFetchTermMonthlyPl(currentFiscalYear, currentMonth, { forceRefresh: false });
      } catch {
        console.error("[management page] 月次P/Lの取得に失敗しました");
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
  // 「最終更新」表示は接続(トークン)更新時刻ではなく、当月分データが実際にfreeeから
  // 取得された時刻を示す(ユーザー確定、2026-09-18)。当月分は4スナップショットとも
  // 同じ操作(定時ジョブ/「更新」ボタン)でまとめて更新されるため、代表として
  // 月次資金収支のfetchedAtを使う。
  const dataUpdatedAt = currentCashFlow?.fetchedAt ?? null;
  // 当期の各月と前年同月を並べる(前期は同じ期の月の位置で対応させる)
  const performanceMonths: PerformanceMonth[] | null =
    currentPerformance && previousPerformance
      ? termMonthsThrough(currentMonth).map((month, i) => ({
          month,
          current: currentPerformance?.[i] ?? null,
          previous: previousPerformance?.[i] ?? null,
        }))
      : null;
  const performanceFetchedAt = latestFetchedAt((currentPerformance ?? []).map((p) => p?.fetchedAt ?? null));

  // 4タブ(概要/業績・採算/財務・資金繰り/入出金明細、2026-11-13 閲覧構成の整理)。中身は上で取得・計算済みの
  // 値をそのまま既存の表示部品へ渡すだけで、タブ用の再取得・再計算はしない。未取得・取得失敗の表示は関連タブに
  // 置いたうえで、概要にも短く残す
  const performanceErrorNotice = performanceError && (
    <p className="text-center text-sm text-[var(--text-muted)]">月次業績・採算の取得に失敗しました。</p>
  );
  const loanStatusErrorNotice = loanStatusError && (
    <p className="text-center text-sm text-[var(--text-muted)]">借入状況の取得に失敗しました。</p>
  );
  const fundReserveErrorNotice = fundReserveError && (
    <p className="text-center text-sm text-[var(--text-muted)]">資金の備えの取得に失敗しました。</p>
  );
  const overviewFailures = [
    performanceError && "月次業績・採算",
    accountingConfirmationError && "経理確認の対象月",
    cashFlowError && "当月の月次資金収支",
    loanStatusError && "借入状況",
    fundReserveError && "資金の備え",
  ].filter((label): label is string => typeof label === "string");

  // 概要の経営サマリー(実績/進捗)・資金サマリーの補足(前月末現預金)。上で読み込んだ保存済みスナップショットから組み立てる
  // (freeeの呼び出しは増やさない)
  const loadedPerformance = [...(currentPerformance ?? []), ...(previousPerformance ?? []), ...twoTermsAgoPerformance].filter(
    (p): p is MonthlyPerformanceSnapshot => p !== null
  );
  const lookupPerformance = (fy: number, month: number) =>
    loadedPerformance.find((p) => p.fiscalYear === fy && p.month === month) ?? null;
  // 概要上段の累計(期首〜最終月。経理報告の売上高累計・経常利益累計と同じ範囲)。最終月は経理確認の指定、
  // 指定が無い間は暫定で仕掛品振替が確認できた月。月末を経過しているが対象外の月は別に示す
  const summaryBasis = resolveSummaryBasis(accountingConfirmation, previousMonthTarget, lookupPerformance);
  const adjustedThrough = summaryBasis.through;
  const adjustedPerformance = adjustedThrough
    ? summarizePerformanceColumn(adjustedThrough, lookupPerformance, { requireMonthEnd: true })
    : null;
  const unadjustedClosedMonths = adjustedThrough ? monthsAfter(adjustedThrough, previousMonthTarget) : [];
  const progressPerformance = summarizePerformanceColumn(targetMonth(currentTerm, currentMonth), lookupPerformance, {
    requireMonthEnd: false,
  });
  // 担保控除額は各時点に有効な経理の管理設定(前月末は前月末時点、現在は当月の設定)。無ければ未設定
  const previousMonthCash = summarizePreviousMonthCash(
    previousMonthTarget,
    cashFlowByMonth.find((c) => c?.fiscalYear === previousMonthTarget.fiscalYear && c.month === previousMonthTarget.month) ??
      null,
    // 担保控除額(手入力)は使わない。担保控除後は表示しない
    { amount: null, asOf: null, source: null },
    now
  );

  // 概要(2026-11-13、11-16更新): 経営サマリー(経理確認済み/仕掛品振替反映分の累計)→経営サマリー(帳簿上の進捗)→資金サマリー(現在)→資金残高(前月末実績)。経理の資金繰り予定は概要に出さない(財務・資金繰りタブで基準日付きで参照)
  const overviewTab = (
    <>
      {overviewFailures.length > 0 && (
        <OverviewNotice>
          {`取得に失敗した項目があります（${overviewFailures.join("・")}）。該当するタブの表示をご確認ください。`}
        </OverviewNotice>
      )}
      {/* 経営サマリー: 帯は1本。上段(累計)と下段(帳簿上の進捗)は小見出しと区切り線で分ける(2026-11-16、ユーザー指定) */}
      <div className="flex flex-col gap-3">
        <SectionBanner>経営サマリー</SectionBanner>
        <PerformanceSummaryBand
          kind="adjusted"
          column={adjustedPerformance}
          failed={performanceError || twoTermsAgoPerformanceError}
          excludedMonths={unadjustedClosedMonths}
          basis={summaryBasis}
          action={
            <AccountingConfirmationForm
              currentMonth={accountingConfirmation?.throughMonth ?? null}
              defaultMonth={adjustedThrough?.key ?? previousMonthTarget.key}
              maxMonth={previousMonthTarget.key}
            />
          }
        />
        <hr className="border-[var(--gridline)]" />
        <PerformanceSummaryBand kind="progress" column={progressPerformance} failed={performanceError} />
        <OverviewLinks links={[{ tab: "performance", label: "業績・採算を見る（売上総利益・利益率・月次表）" }]} />
      </div>
      <div className="flex flex-col gap-3">
        <ManagementSummary
          term={currentTerm}
          month={currentMonth}
          cashFlow={currentCashFlow}
          loanStatus={loanStatus}
          fetchedAt={dataUpdatedAt}
        />
        <OverviewLinks
          links={[
            { tab: "finance", label: "財務・資金繰りを見る" },
            { tab: "cashflow", label: "入出金明細を見る" },
          ]}
        />
      </div>
      <PreviousMonthEndBalance
        target={previousMonthTarget}
        cash={previousMonthCash}
        loans={summarizePreviousMonthLoans(previousMonthTarget, previousMonthLoanSnapshot)}
      />
    </>
  );

  const performanceTab = (
    <>
      {performanceMonths && (
        <>
          <MonthlyPerformanceSection months={performanceMonths} fetchedAt={performanceFetchedAt} />
          <CostStructureSection months={performanceMonths} />
        </>
      )}
      {performanceErrorNotice}
      {referenceForecast && <ReferencePlSection record={referenceForecast} />}
    </>
  );

  const financeTab = (
    <>
      {loanStatusErrorNotice}
      {loanStatus && <LoanStatusTable loanStatus={loanStatus} />}
      {fundReserveErrorNotice}
      {fundReserve && <FundReserveSection fundReserve={fundReserve} />}
      {referenceForecast && <ReferenceCashForecastSection record={referenceForecast} />}
    </>
  );

  const cashFlowTab = (
    <>
      <p className="text-xs text-[var(--text-muted)]">
        {"※ このタブの月次資金収支・支出構成は入出金ベース（現金の動き）です。「業績・採算」タブは発生主義の損益ベースのため、金額は一致しません。"}
      </p>
      {cashFlowError && (
        <p className="text-center text-sm text-[var(--text-muted)]">
          freeeからのデータ取得に失敗しました（権限不足の場合、freeeアプリの権限設定を
          変更した後は再接続が必要です。下記から再度お試しください）。
        </p>
      )}
      <MonthlyCashFlowScrollTable columns={cashFlowColumns} />
      {currentCashFlow && (
        <ExpenseCompositionSection
          expenseByCategory={currentCashFlow.expenseByCategory}
          unclassified={currentCashFlow.outflow?.unclassified}
          externalExpenseTotal={currentCashFlow.externalExpenseTotal}
        />
      )}
    </>
  );

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
              <ManagementTabs
                tabs={[
                  { id: "overview", label: "概要", content: overviewTab },
                  { id: "performance", label: "業績・採算", content: performanceTab },
                  { id: "finance", label: "財務・資金繰り", content: financeTab },
                  { id: "cashflow", label: "入出金明細", content: cashFlowTab },
                ]}
              />
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
