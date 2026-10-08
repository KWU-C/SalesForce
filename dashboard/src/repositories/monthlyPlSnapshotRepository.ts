import { getFirestoreClient } from "@/services/firestore/firestoreClient";
import type { MonthlyPlSnapshot } from "@/features/management-dashboard/monthlyPl";

// 事業収支の推移グラフ専用の月次P/L。当期累計を持つfinancialSummarySnapshotsとは別コレクションで、
// そちらには一切書き込まない(ユーザー確定、2026-10-08)。
const COLLECTION = "monthlyPlSnapshots";

// (fiscalYear, month)で1件に決まるIDにする。再取得のたびに同じドキュメントを上書きするため、
// 何度実行しても同じ月が二重に計上されない
function docId(fiscalYear: number, month: number): string {
  return `${fiscalYear}-${month}`;
}

interface FirestoreTimestampLike {
  toDate(): Date;
}

type StoredFields = Omit<MonthlyPlSnapshot, "fetchedAt"> & { fetchedAt: FirestoreTimestampLike };

export interface MonthlyPlStore {
  get(fiscalYear: number, month: number): Promise<MonthlyPlSnapshot | null>;
  save(snapshot: MonthlyPlSnapshot): Promise<void>;
}

function toSnapshot(data: StoredFields): MonthlyPlSnapshot {
  return { ...data, fetchedAt: data.fetchedAt.toDate() };
}

function createFirestoreStore(): MonthlyPlStore {
  return {
    async get(fiscalYear, month) {
      const doc = await getFirestoreClient().collection(COLLECTION).doc(docId(fiscalYear, month)).get();
      if (!doc.exists) return null;
      return toSnapshot(doc.data() as StoredFields);
    },
    async save(snapshot) {
      // mergeせず丸ごと置き換える(古い算出バージョンのフィールドを残さない)
      await getFirestoreClient().collection(COLLECTION).doc(docId(snapshot.fiscalYear, snapshot.month)).set(snapshot);
    },
  };
}

export async function getMonthlyPlSnapshot(
  fiscalYear: number,
  month: number,
  store: MonthlyPlStore = createFirestoreStore()
): Promise<MonthlyPlSnapshot | null> {
  return store.get(fiscalYear, month);
}

export async function saveMonthlyPlSnapshot(
  snapshot: MonthlyPlSnapshot,
  store: MonthlyPlStore = createFirestoreStore()
): Promise<void> {
  await store.save(snapshot);
}
