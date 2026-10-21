import { refreshCurrentMonthSnapshots } from "../features/management-dashboard/refreshCurrentMonthSnapshots";
import { refreshPastCashFlows } from "../features/management-dashboard/refreshPastCashFlows";
import { getCurrentFiscalPeriod, freeeFiscalYearForTerm } from "../config/fiscalPeriods";
import { describeRuntimeEnvironment } from "../services/firestore/productionDataWriteGuard";
import { saveFinanceRefreshRun } from "../repositories/financeRefreshRunRepository";
import { jstDate } from "../utils/jstDate";
import type { FinanceRefreshRun } from "../repositories/financeRefreshRunRepository";

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

export interface FinanceRefreshJobDeps {
  run?: typeof runScheduledFinanceRefresh;
  recordRun?: (run: FinanceRefreshRun) => Promise<void>;
  now?: () => Date;
  log?: (message: string) => void;
  error?: (message: string) => void;
}


/**
 * Jobの本体。終了コード(0=成功、1=失敗・中止)を返し、プロセスは終了しない(テストできるようにするため)。
 *
 * 最初に実行環境の名前・接続先データベース・書き込み可否をログに出す(名前はCloud Runが設定する
 * CLOUD_RUN_JOB/K_SERVICEの値で、機密情報ではない)。書き込めない環境(devのJob・ローカルなど)では、
 * freee・Firestoreに一切触れる前に中止する(共有Firestoreの上書き防止、2026-10-21)。
 * 環境名を出すのは、「変数が無い」と「別のJobで動いている」を本番デプロイ前にログで見分けるため。
 */
export async function runFinanceRefreshJob(deps: FinanceRefreshJobDeps = {}): Promise<number> {
  const run = deps.run ?? runScheduledFinanceRefresh;
  const log = deps.log ?? ((m: string) => console.log(m));
  const error = deps.error ?? ((m: string) => console.error(m));
  const runtime = describeRuntimeEnvironment();
  const where = `${runtime.name === null ? runtime.kind : `${runtime.kind}=${runtime.name}`} / 書き込み先DB: ${runtime.databaseId}`;
  if (!runtime.writable) {
    error(`[scheduledFinanceRefresh] 実行環境: ${where} / 書き込み: 不可のため、更新を行いません`);
    return 1;
  }
  log(`[scheduledFinanceRefresh] 実行環境: ${where} / 書き込み: 許可`);
  const now = deps.now ?? (() => new Date());
  const startedAt = now();
  let status: FinanceRefreshRun["status"] = "failed";
  let detail: string | null = null;
  let code = 1;
  try {
    const { fiscalYear, month, connected, refreshedPastMonths, refreshedPreviousTerm } = await run();
    if (!connected) {
      detail = "freee未接続";
      error(`[scheduledFinanceRefresh] freee未接続のため${fiscalYear}期${month}月分を更新できませんでした`);
    } else {
      log(
        `[scheduledFinanceRefresh] ${fiscalYear}年度${month}月分の当月スナップショットと、過去月の資金収支` +
          `(${refreshedPastMonths.length > 0 ? refreshedPastMonths.map((m) => `${m}月`).join(",") : "なし"}` +
          `${refreshedPreviousTerm !== null ? `、${refreshedPreviousTerm}期の12か月・通期` : ""})を更新しました`
      );
      status = "succeeded";
      code = 0;
    }
  } catch (e) {
    // ここで出すのは自前でthrowしているエラーメッセージのみ(freee_api_error等の
    // 固定文言、トークン等の機微情報は含まない。既存のpage.tsx/refresh routeと同じ方針)
    detail = e instanceof Error ? e.message : String(e);
    error(`[scheduledFinanceRefresh] 更新に失敗しました: ${detail}`);
  }
  // 処理全体の成否を記録する(資金繰り予測のJobが確かめる)。記録に失敗しても更新の結果(終了コード)は変えない
  try {
    await (deps.recordRun ?? saveFinanceRefreshRun)({
      date: jstDate(startedAt),
      executionName: process.env.CLOUD_RUN_EXECUTION ?? "local",
      status,
      detail,
      startedAt: startedAt.toISOString(),
      finishedAt: now().toISOString(),
    });
  } catch (e) {
    error(`[scheduledFinanceRefresh] 実行結果の記録に失敗しました: ${e instanceof Error ? e.name : "unknown"}`);
  }
  return code;
}

async function main(): Promise<void> {
  const code = await runFinanceRefreshJob();
  // Firestore Admin SDKはgRPCストリームを開いたままにするため、正常終了時も
  // プロセスが自然終了しない。Cloud Run Jobは1回きりのバッチ実行なので、
  // 明示的にプロセスを終了させる(放置するとtask-timeoutまで無駄に課金される)。
  process.exit(code);
}

if (require.main === module) {
  void main();
}
