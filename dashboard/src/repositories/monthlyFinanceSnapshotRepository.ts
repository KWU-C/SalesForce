import { getFirestoreClient } from "@/services/firestore/firestoreClient";
import type { MonthlyFinanceSnapshot } from "@/features/management-dashboard/types";

// processMemos/freeeAuthとは別コレクション。Dashboard表示に必要な集計値のみを保存し、
// freeeの生レスポンスは保存しない(ユーザー確定、2026-09-14)。
const COLLECTION = "monthlyFinanceSnapshots";

function docId(fiscalYear: number, month: number): string {
  return `${fiscalYear}-${month}`;
}

interface FirestoreTimestampLike {
  toDate(): Date;
}

type StoredFields = Omit<MonthlyFinanceSnapshot, "fetchedAt"> & { fetchedAt: FirestoreTimestampLike };

export interface MonthlyFinanceSnapshotStore {
  get(fiscalYear: number, month: number): Promise<MonthlyFinanceSnapshot | null>;
  save(snapshot: MonthlyFinanceSnapshot): Promise<void>;
}

function toSnapshot(data: StoredFields): MonthlyFinanceSnapshot {
  return { ...data, fetchedAt: data.fetchedAt.toDate() };
}

function createFirestoreStore(): MonthlyFinanceSnapshotStore {
  return {
    async get(fiscalYear, month) {
      const doc = await getFirestoreClient().collection(COLLECTION).doc(docId(fiscalYear, month)).get();
      if (!doc.exists) return null;
      return toSnapshot(doc.data() as StoredFields);
    },
    async save(snapshot) {
      await getFirestoreClient()
        .collection(COLLECTION)
        .doc(docId(snapshot.fiscalYear, snapshot.month))
        .set(snapshot, { merge: true });
    },
  };
}

export async function getMonthlyFinanceSnapshot(
  fiscalYear: number,
  month: number,
  store: MonthlyFinanceSnapshotStore = createFirestoreStore()
): Promise<MonthlyFinanceSnapshot | null> {
  return store.get(fiscalYear, month);
}

export async function saveMonthlyFinanceSnapshot(
  snapshot: MonthlyFinanceSnapshot,
  store: MonthlyFinanceSnapshotStore = createFirestoreStore()
): Promise<void> {
  await store.save(snapshot);
}
