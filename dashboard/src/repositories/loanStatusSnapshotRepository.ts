import { getFirestoreClient } from "@/services/firestore/firestoreClient";
import type { LoanStatusSnapshot } from "@/features/management-dashboard/loanStatus";

// monthlyCashFlowSnapshotsとは別コレクション。過去月=Firestore/当月=freeeライブの
// 切り替えに使う(ユーザー確定、2026-09-15)。
const COLLECTION = "loanStatusSnapshots";

function docId(fiscalYear: number, month: number): string {
  return `${fiscalYear}-${month}`;
}

interface FirestoreTimestampLike {
  toDate(): Date;
}

type StoredFields = Omit<LoanStatusSnapshot, "fetchedAt"> & { fetchedAt: FirestoreTimestampLike };

export interface LoanStatusStore {
  get(fiscalYear: number, month: number): Promise<LoanStatusSnapshot | null>;
  save(snapshot: LoanStatusSnapshot): Promise<void>;
}

function toSnapshot(data: StoredFields): LoanStatusSnapshot {
  return { ...data, fetchedAt: data.fetchedAt.toDate() };
}

function createFirestoreStore(): LoanStatusStore {
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

export async function getLoanStatusSnapshot(
  fiscalYear: number,
  month: number,
  store: LoanStatusStore = createFirestoreStore()
): Promise<LoanStatusSnapshot | null> {
  return store.get(fiscalYear, month);
}

export async function saveLoanStatusSnapshot(
  snapshot: LoanStatusSnapshot,
  store: LoanStatusStore = createFirestoreStore()
): Promise<void> {
  await store.save(snapshot);
}
