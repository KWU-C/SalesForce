import { getFirestoreClient } from "@/services/firestore/firestoreClient";
import type { TermCashFlowTotal } from "@/features/management-dashboard/termCashFlowTotal";

// monthlyCashFlowSnapshots等とは別コレクション。月次スナップショットとは別種の
// データ(終わった期の固定合計値、以後不変)として明確に分離する(ユーザー確定、2026-09-18)。
const COLLECTION = "termCashFlowSnapshots";

function docId(term: number): string {
  return `${term}`;
}

interface FirestoreTimestampLike {
  toDate(): Date;
}

type StoredFields = Omit<TermCashFlowTotal, "computedAt"> & { computedAt: FirestoreTimestampLike };

export interface TermCashFlowStore {
  get(term: number): Promise<TermCashFlowTotal | null>;
  save(snapshot: TermCashFlowTotal): Promise<void>;
}

function toSnapshot(data: StoredFields): TermCashFlowTotal {
  return { ...data, computedAt: data.computedAt.toDate() };
}

function createFirestoreStore(): TermCashFlowStore {
  return {
    async get(term) {
      const doc = await getFirestoreClient().collection(COLLECTION).doc(docId(term)).get();
      if (!doc.exists) return null;
      return toSnapshot(doc.data() as StoredFields);
    },
    async save(snapshot) {
      await getFirestoreClient().collection(COLLECTION).doc(docId(snapshot.term)).set(snapshot, { merge: true });
    },
  };
}

export async function getTermCashFlowSnapshot(
  term: number,
  store: TermCashFlowStore = createFirestoreStore()
): Promise<TermCashFlowTotal | null> {
  return store.get(term);
}

export async function saveTermCashFlowSnapshot(
  snapshot: TermCashFlowTotal,
  store: TermCashFlowStore = createFirestoreStore()
): Promise<void> {
  await store.save(snapshot);
}
