import { refreshCurrentMonthSnapshots } from "../features/management-dashboard/refreshCurrentMonthSnapshots";
import { refreshPastCashFlows } from "../features/management-dashboard/refreshPastCashFlows";
import { getCurrentFiscalPeriod, freeeFiscalYearForTerm } from "../config/fiscalPeriods";

/**
 * Cloud Run Jobのエントリポイント本体。Cloud Schedulerが毎日18:00(Asia/Tokyo)に
 * このJobの実行をトリガーする(Cloud Run Admin APIの`jobs.run`経由。Web側のIAP・
 * OAuth・Cloud Run IAM設定には一切触れず、経由もしない。ユーザー確定、2026-09-18)。
 *
 * Next.js/React/IAP検証には一切依存しない。このファイルが直接importするのは
 * features/management-dashboardのサービス層とconfig/fiscalPeriodsのみで、
 * どちらもNext.jsのHTTPレイヤーに依存しない純粋な関数(Web手動更新ルートと共通の
 * refreshCurrentMonthSnapshotsをそのまま再利用、重複実装を避けている)。
 *
 * fiscalYear/monthは引数を受け取らず、実行時点の現在時刻から算出する(任意月を指定させる必要がない)。
 *
 * 当月分を更新した後、当月より前の月次資金収支も取り直す(refreshPastCashFlows。月次決算などで
 * 過去月の仕訳が変わっても反映させる、ユーザー指示、2026-10-15)。当月分を先に保存するため、
 * 過去月の取り直しが失敗しても当月分の更新は残る(失敗はthrowし、Jobの終了コードで分かる)。
 */
export async function runScheduledFinanceRefresh(): Promise<{
  fiscalYear: number;
  month: number;
  connected: boolean;
  refreshedPastMonths: number[];
  refreshedPreviousTerm: number | null;
}> {
  const { term, currentMonth } = getCurrentFiscalPeriod();
  const fiscalYear = freeeFiscalYearForTerm(term);

  const { connected } = await refreshCurrentMonthSnapshots(fiscalYear, currentMonth, {
    includeFinancialSummary: true,
  });
  if (!connected) {
    return { fiscalYear, month: currentMonth, connected, refreshedPastMonths: [], refreshedPreviousTerm: null };
  }

  const past = await refreshPastCashFlows(term, currentMonth);
  return {
    fiscalYear,
    month: currentMonth,
    connected: past.connected,
    refreshedPastMonths: past.refreshedMonths,
    refreshedPreviousTerm: past.refreshedPreviousTerm,
  };
}

async function main(): Promise<void> {
  try {
    const { fiscalYear, month, connected, refreshedPastMonths, refreshedPreviousTerm } =
      await runScheduledFinanceRefresh();
    if (!connected) {
      console.error(`[scheduledFinanceRefresh] freee未接続のため${fiscalYear}期${month}月分を更新できませんでした`);
      process.exitCode = 1;
      return;
    }
    console.log(
      `[scheduledFinanceRefresh] ${fiscalYear}年度${month}月分の当月スナップショットと、過去月の資金収支` +
        `(${refreshedPastMonths.length > 0 ? refreshedPastMonths.map((m) => `${m}月`).join(",") : "なし"}` +
        `${refreshedPreviousTerm !== null ? `、${refreshedPreviousTerm}期の12か月・通期` : ""})を更新しました`
    );
  } catch (error) {
    // ここで出すのは自前でthrowしているエラーメッセージのみ(freee_api_error等の
    // 固定文言、トークン等の機微情報は含まない。既存のpage.tsx/refresh routeと同じ方針)
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[scheduledFinanceRefresh] 更新に失敗しました: ${detail}`);
    process.exitCode = 1;
  } finally {
    // Firestore Admin SDKはgRPCストリームを開いたままにするため、正常終了時も
    // プロセスが自然終了しない。Cloud Run Jobは1回きりのバッチ実行なので、
    // 明示的にプロセスを終了させる(放置するとtask-timeoutまで無駄に課金される)。
    process.exit(process.exitCode ?? 0);
  }
}

if (require.main === module) {
  void main();
}
