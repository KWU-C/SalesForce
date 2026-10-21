import { getFirestoreClient } from "@/services/firestore/firestoreClient";
import { assertProductionDataWritable } from "@/services/firestore/productionDataWriteGuard";

/**
 * 既存の定時更新(scheduledFinanceRefresh)の実行結果の記録(段階3、2026-10-21)。
 * 資金繰り予測のJobは、その日の定時更新が「処理全体として」成功したかをここで確かめてから予測する
 * (スナップショットの更新日時だけでは、当月分は更新できたが過去月の取り直しで失敗した、などを
 * 見分けられないため)。ドキュメントIDは日本時間の日付。同じ日に複数回動いた場合は最後の結果で上書きする。
 */
const COLLECTION = "financeRefreshRuns";

export interface FinanceRefreshRun {
  /** 日本時間の日付(YYYY-MM-DD) */
  date: string;
  executionName: string;
  /** succeeded: 当月分・過去月分の更新がすべて成功 / failed: どこかで失敗、または freee 未接続 */
  status: "succeeded" | "failed";
  /** 失敗の概要(自前の固定文言のみ。トークン等は含めない) */
  detail: string | null;
  startedAt: string;
  finishedAt: string;
}

export interface FinanceRefreshRunStore {
  set(date: string, run: FinanceRefreshRun): Promise<void>;
  get(date: string): Promise<FinanceRefreshRun | null>;
}

function createFirestoreStore(): FinanceRefreshRunStore {
  return {
    async set(date, run) {
      assertProductionDataWritable(COLLECTION);
      await getFirestoreClient().collection(COLLECTION).doc(date).set(run);
    },
    async get(date) {
      const doc = await getFirestoreClient().collection(COLLECTION).doc(date).get();
      return doc.exists ? (doc.data() as FinanceRefreshRun) : null;
    },
  };
}

export async function saveFinanceRefreshRun(run: FinanceRefreshRun, store: FinanceRefreshRunStore = createFirestoreStore()): Promise<void> {
  await store.set(run.date, run);
}

export async function getFinanceRefreshRun(date: string, store: FinanceRefreshRunStore = createFirestoreStore()): Promise<FinanceRefreshRun | null> {
  return store.get(date);
}
