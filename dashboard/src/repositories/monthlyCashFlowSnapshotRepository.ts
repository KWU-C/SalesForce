import { getFirestoreClient } from "@/services/firestore/firestoreClient";
import type { MonthlyCashFlow } from "@/features/management-dashboard/types";

// processMemos/freeeAuth/monthlyFinanceとは別コレクション。Dashboard表示に必要な
// 集計値のみを保存し、freeeの生レスポンスは保存しない(ユーザー確定、2026-09-14)。
const COLLECTION = "monthlyCashFlowSnapshots";

function docId(fiscalYear: number, month: number): string {
  return `${fiscalYear}-${month}`;
}

interface FirestoreTimestampLike {
  toDate(): Date;
}

type StoredFields = Omit<MonthlyCashFlow, "fetchedAt"> & { fetchedAt: FirestoreTimestampLike };

export interface MonthlyCashFlowStore {
  get(fiscalYear: number, month: number): Promise<MonthlyCashFlow | null>;
  save(snapshot: MonthlyCashFlow): Promise<void>;
}

function toSnapshot(data: StoredFields): MonthlyCashFlow {
  return { ...data, fetchedAt: data.fetchedAt.toDate() };
}

function createFirestoreStore(): MonthlyCashFlowStore {
  return {
    async get(fiscalYear, month) {
      const doc = await getFirestoreClient().collection(COLLECTION).doc(docId(fiscalYear, month)).get();
      if (!doc.exists) return null;
      const data = doc.data() as StoredFields;
      // interestCashFlow追加(2026-09-15)より前に保存されたスナップショットはこのキーを
      // 持たない。欠損値を0円と推測して埋めず、キャッシュミス扱いにして呼び出し側
      // (monthlyCashFlowService)にfreeeから再取得・再保存させる(データ未設定の推測禁止)
      if (data.interestCashFlow === undefined) return null;
      return toSnapshot(data);
    },
    async save(snapshot) {
      await getFirestoreClient()
        .collection(COLLECTION)
        .doc(docId(snapshot.fiscalYear, snapshot.month))
        .set(snapshot, { merge: true });
    },
  };
}

export async function getMonthlyCashFlowSnapshot(
  fiscalYear: number,
  month: number,
  store: MonthlyCashFlowStore = createFirestoreStore()
): Promise<MonthlyCashFlow | null> {
  return store.get(fiscalYear, month);
}

export async function saveMonthlyCashFlowSnapshot(
  snapshot: MonthlyCashFlow,
  store: MonthlyCashFlowStore = createFirestoreStore()
): Promise<void> {
  await store.save(snapshot);
}
