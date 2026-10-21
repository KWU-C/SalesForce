import { getFirestoreClient } from "@/services/firestore/firestoreClient";
import { assertProductionDataWritable } from "@/services/firestore/productionDataWriteGuard";
import type { CashForecastResult, SourceFailure } from "@/features/management-dashboard/cashForecast";

/**
 * 資金繰り予測の保存先(段階3、名称はユーザー確定 2026-10-21)。
 * - cashForecasts/{基準日}: 成功した予測だけ。失敗・中止では書かない(前回の成功を上書きしない)。
 *   同じ日に再実行して成功した場合だけ、その日の分を上書きする
 * - cashForecastRuns/{基準日}_{実行名}: 実行ごとの記録(成否・失敗した取得元・中止理由)。金額は持たない
 * 取引の明細・取引先は保存しない(予測の集計値だけ)。参考変動幅は保存するが画面には出さない。
 */
const FORECASTS = "cashForecasts";
const RUNS = "cashForecastRuns";

export type CashForecastRunStatus = "succeeded" | "failed" | "skipped";

export interface CashForecastRun {
  baseDate: string;
  executionName: string;
  status: CashForecastRunStatus;
  /** failed: 取得元ごとの失敗 / skipped: 中止の理由 */
  failures: SourceFailure[];
  skipReason: string | null;
  startedAt: string;
  finishedAt: string;
}

export interface StoredCashForecast {
  baseDate: string;
  generatedAt: string;
  executionName: string;
  /** 当月の途中までの実績(月次資金収支スナップショット)の取得日時 */
  currentMonthSnapshotFetchedAt: string | null;
  result: Extract<CashForecastResult, { status: "ok" }>;
}

export interface CashForecastStore {
  setForecast(baseDate: string, doc: StoredCashForecast): Promise<void>;
  setRun(id: string, run: CashForecastRun): Promise<void>;
  getLatestForecast(): Promise<StoredCashForecast | null>;
}

/** Firestoreはundefinedを保存できないため、JSONとして正規化してから書く(nullは残る) */
function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createFirestoreStore(): CashForecastStore {
  return {
    async setForecast(baseDate, doc) {
      assertProductionDataWritable(FORECASTS);
      await getFirestoreClient().collection(FORECASTS).doc(baseDate).set(plain(doc));
    },
    async setRun(id, run) {
      assertProductionDataWritable(RUNS);
      await getFirestoreClient().collection(RUNS).doc(id).set(plain(run));
    },
    async getLatestForecast() {
      const snap = await getFirestoreClient().collection(FORECASTS).orderBy("baseDate", "desc").limit(1).get();
      return snap.empty ? null : (snap.docs[0].data() as StoredCashForecast);
    },
  };
}

export function cashForecastRunId(baseDate: string, executionName: string): string {
  return `${baseDate}_${executionName}`;
}

/** 成功した予測だけを保存する。ok以外を渡したら保存せずにエラーにする(呼び出し側の誤りを防ぐ) */
export async function saveSucceededCashForecast(doc: StoredCashForecast, store: CashForecastStore = createFirestoreStore()): Promise<void> {
  if (doc.result.status !== "ok") throw new Error("成功した予測以外は cashForecasts に保存しません");
  await store.setForecast(doc.baseDate, doc);
}

export async function saveCashForecastRun(run: CashForecastRun, store: CashForecastStore = createFirestoreStore()): Promise<void> {
  await store.setRun(cashForecastRunId(run.baseDate, run.executionName), run);
}

export async function getLatestCashForecast(store: CashForecastStore = createFirestoreStore()): Promise<StoredCashForecast | null> {
  return store.getLatestForecast();
}
