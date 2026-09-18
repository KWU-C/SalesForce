import { getFirestoreClient } from "@/services/firestore/firestoreClient";
import type { FinancialSummarySnapshot } from "@/features/management-dashboard/financialSummary";

// monthlyCashFlowSnapshots/loanStatusSnapshotsとは別コレクション。当期累計サマリーを
// 当月分のスナップショットとして保存する(過去月=Firestore/当月=手動更新orスケジュール更新、
// 他の3スナップショットと同じ切り替え、ユーザー確定、2026-09-18)。
const COLLECTION = "financialSummarySnapshots";

function docId(fiscalYear: number, month: number): string {
  return `${fiscalYear}-${month}`;
}

interface FirestoreTimestampLike {
  toDate(): Date;
}

type StoredFields = Omit<FinancialSummarySnapshot, "fetchedAt"> & { fetchedAt: FirestoreTimestampLike };

export interface FinancialSummaryStore {
  get(fiscalYear: number, month: number): Promise<FinancialSummarySnapshot | null>;
  save(snapshot: FinancialSummarySnapshot): Promise<void>;
}

function toSnapshot(data: StoredFields): FinancialSummarySnapshot {
  return { ...data, fetchedAt: data.fetchedAt.toDate() };
}

function createFirestoreStore(): FinancialSummaryStore {
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

export async function getFinancialSummarySnapshot(
  fiscalYear: number,
  month: number,
  store: FinancialSummaryStore = createFirestoreStore()
): Promise<FinancialSummarySnapshot | null> {
  return store.get(fiscalYear, month);
}

export async function saveFinancialSummarySnapshot(
  snapshot: FinancialSummarySnapshot,
  store: FinancialSummaryStore = createFirestoreStore()
): Promise<void> {
  await store.save(snapshot);
}
