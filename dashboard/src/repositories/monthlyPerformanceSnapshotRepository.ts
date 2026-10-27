import { getFirestoreClient } from "@/services/firestore/firestoreClient";
import type { MonthlyPerformanceSnapshot } from "@/features/management-dashboard/monthlyPerformance";

// 月次業績・採算(当期と前期の各月)。経理月次報告との比較に使うmonthlyPlSnapshotsとは別コレクションで、
// そちらには一切書き込まない(ユーザー確定、2026-10-27)。
const COLLECTION = "monthlyPerformanceSnapshots";

// (fiscalYear, month)で1件に決まるIDにする。再取得のたびに同じドキュメントを上書きするため、
// 何度実行しても同じ月が二重に計上されない
function docId(fiscalYear: number, month: number): string {
  return `${fiscalYear}-${month}`;
}

interface FirestoreTimestampLike {
  toDate(): Date;
}

type StoredFields = Omit<MonthlyPerformanceSnapshot, "fetchedAt"> & { fetchedAt: FirestoreTimestampLike };

export interface MonthlyPerformanceStore {
  get(fiscalYear: number, month: number): Promise<MonthlyPerformanceSnapshot | null>;
  save(snapshot: MonthlyPerformanceSnapshot): Promise<void>;
}

function toSnapshot(data: StoredFields): MonthlyPerformanceSnapshot {
  return { ...data, fetchedAt: data.fetchedAt.toDate() };
}

function createFirestoreStore(): MonthlyPerformanceStore {
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

export async function getMonthlyPerformanceSnapshot(
  fiscalYear: number,
  month: number,
  store: MonthlyPerformanceStore = createFirestoreStore()
): Promise<MonthlyPerformanceSnapshot | null> {
  return store.get(fiscalYear, month);
}

export async function saveMonthlyPerformanceSnapshot(
  snapshot: MonthlyPerformanceSnapshot,
  store: MonthlyPerformanceStore = createFirestoreStore()
): Promise<void> {
  await store.save(snapshot);
}
