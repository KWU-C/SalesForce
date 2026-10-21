import { CASH_FORECAST_SETTINGS } from "../config/cashForecastSettings";
import type { CashForecastSettings } from "../config/cashForecastSettings";
import { buildCashForecast } from "../features/management-dashboard/cashForecast";
import type { SourceFailure } from "../features/management-dashboard/cashForecast";
import { collectForecastInputs } from "../features/management-dashboard/cashForecastInputs";
import { saveCashForecastRun, saveSucceededCashForecast } from "../repositories/cashForecastRepository";
import type { CashForecastRun, StoredCashForecast } from "../repositories/cashForecastRepository";
import { getFinanceRefreshRun } from "../repositories/financeRefreshRunRepository";
import type { FinanceRefreshRun } from "../repositories/financeRefreshRunRepository";
import { describeRuntimeEnvironment } from "../services/firestore/productionDataWriteGuard";
import { jstDate } from "../utils/jstDate";

/**
 * 資金繰り予測のCloud Run Job(段階3、既存の定時更新とは別Job。ユーザー確定 2026-10-21)。
 * GCP上のJob作成・スケジュール設定は別途承認(このファイルはまだcloudbuild.yamlから使われない)。
 *
 * 流れ:
 * 1. 実行環境と接続先データベースの組み合わせを確かめ、書き込めなければ何にも触れずに中止
 * 2. 当日(日本時間)の定時更新が「処理全体として成功」した記録(financeRefreshRuns)が無ければ中止。
 *    予測は作らず、実行記録に中止理由だけ残す(前回成功した予測はそのまま)
 * 3. 入力を集め、当月・前月の月次資金収支スナップショットが当日の定時更新(開始時刻以降)で取り直された
 *    ものかを確かめる(鮮度)。古ければ中止。前々月以前は確定した月で毎日は取り直さないため対象外
 * 4. 予測を計算。失敗(取得失敗など)なら実行記録だけ残し、予測は保存しない
 * 5. 成功した予測だけを cashForecasts に保存し、実行記録を残す
 * 既存の定時更新Jobとは別プロセスで、こちらが失敗しても定時更新には影響しない。
 */

export interface CashForecastJobDeps {
  now?: () => Date;
  settings?: CashForecastSettings;
  getRefreshRun?: (date: string) => Promise<FinanceRefreshRun | null>;
  collect?: typeof collectForecastInputs;
  build?: typeof buildCashForecast;
  saveForecast?: (doc: StoredCashForecast) => Promise<void>;
  saveRun?: (run: CashForecastRun) => Promise<void>;
  log?: (message: string) => void;
  error?: (message: string) => void;
}

export async function runCashForecastJob(deps: CashForecastJobDeps = {}): Promise<number> {
  const log = deps.log ?? ((m: string) => console.log(m));
  const error = deps.error ?? ((m: string) => console.error(m));
  const runtime = describeRuntimeEnvironment();
  const where = `${runtime.name === null ? runtime.kind : `${runtime.kind}=${runtime.name}`} / 書き込み先DB: ${runtime.databaseId}`;
  if (!runtime.writable) {
    error(`[cashForecastJob] 実行環境: ${where} / 書き込み: 不可のため、予測を行いません`);
    return 1;
  }
  log(`[cashForecastJob] 実行環境: ${where} / 書き込み: 許可`);

  const now = deps.now ?? (() => new Date());
  const settings = deps.settings ?? CASH_FORECAST_SETTINGS;
  const startedAt = now();
  const baseDate = jstDate(startedAt);
  const executionName = process.env.CLOUD_RUN_EXECUTION ?? "local";
  const saveRun = deps.saveRun ?? saveCashForecastRun;
  const record = async (status: CashForecastRun["status"], failures: SourceFailure[], skipReason: string | null) => {
    try {
      await saveRun({ baseDate, executionName, status, failures, skipReason, startedAt: startedAt.toISOString(), finishedAt: now().toISOString() });
    } catch (e) {
      error(`[cashForecastJob] 実行記録の保存に失敗しました: ${e instanceof Error ? e.name : "unknown"}`);
    }
  };

  try {
    const refresh = await (deps.getRefreshRun ?? getFinanceRefreshRun)(baseDate);
    if (refresh === null || refresh.status !== "succeeded") {
      const reason = refresh === null ? "当日の定時更新の記録がありません" : `当日の定時更新が成功していません(${refresh.detail ?? "詳細なし"})`;
      log(`[cashForecastJob] ${reason}。予測を行わず、前回の予測をそのまま残します`);
      await record("skipped", [], reason);
      return 0;
    }

    const { inputs, currentMonthSnapshotFetchedAt, snapshotFetchedAt } = await (deps.collect ?? collectForecastInputs)(baseDate, settings);
    const stale = staleMonths(baseDate, snapshotFetchedAt, refresh.startedAt);
    if (stale.length > 0) {
      const reason = `実績データが当日の定時更新より古い、または無い(${stale.join(", ")})`;
      log(`[cashForecastJob] ${reason}。予測を行わず、前回の予測をそのまま残します`);
      await record("skipped", [], reason);
      return 0;
    }
    const result = (deps.build ?? buildCashForecast)(inputs, settings);
    if (result.status !== "ok") {
      error(`[cashForecastJob] 予測を作れませんでした(取得失敗: ${result.failures.map((f) => `${f.source}:${f.kind}`).join(", ")})。前回の予測をそのまま残します`);
      await record("failed", result.failures, null);
      return 1;
    }
    await (deps.saveForecast ?? saveSucceededCashForecast)({
      baseDate,
      generatedAt: now().toISOString(),
      executionName,
      currentMonthSnapshotFetchedAt,
      result,
    });
    await record("succeeded", [], null);
    log(`[cashForecastJob] ${baseDate}の資金繰り予測を保存しました(${result.months.length}か月、警告${result.warnings.length}件)`);
    return 0;
  } catch (e) {
    // 自前の固定文言・エラー名だけを出す(freeeの応答本文やトークンは出さない)
    const name = e instanceof Error ? e.name : "unknown";
    error(`[cashForecastJob] 予測の途中で失敗しました: ${name}。前回の予測をそのまま残します`);
    await record("failed", [{ source: "job", kind: name }], null);
    return 1;
  }
}

/**
 * 当月と前月のスナップショットが、当日の定時更新の開始時刻以降に取得されたものか。
 * 古い・無い月の一覧を返す(空なら鮮度は十分)。
 */
export function staleMonths(baseDate: string, fetchedAt: Record<string, string>, refreshStartedAt: string): string[] {
  const current = baseDate.slice(0, 7);
  const [y, m] = current.split("-").map(Number);
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  return [prev, current].filter((month) => {
    const at = fetchedAt[month];
    return at === undefined || Date.parse(at) < Date.parse(refreshStartedAt);
  });
}

async function main(): Promise<void> {
  const code = await runCashForecastJob();
  // Firestore Admin SDKのgRPCストリームが残るため明示的に終了する(scheduledFinanceRefreshと同じ)
  process.exit(code);
}

if (require.main === module) {
  void main();
}
