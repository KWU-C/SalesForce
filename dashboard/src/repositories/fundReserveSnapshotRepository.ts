import { getFirestoreClient } from "@/services/firestore/firestoreClient";
import type { FundReserveCoreSnapshot } from "@/features/management-dashboard/fundReserve";

// monthlyCashFlowSnapshots/loanStatusSnapshotsとは別コレクション。過去月=Firestore/
// 当月=freeeライブの切り替えに使う(ユーザー確定、2026-09-15)。現預金(cash)は月次資金収支の
// スナップショットに既にあるため、ここにはfreee由来の部分(FundReserveCore)のみ保存する。
const COLLECTION = "fundReserveSnapshots";

function docId(fiscalYear: number, month: number): string {
  return `${fiscalYear}-${month}`;
}

interface FirestoreTimestampLike {
  toDate(): Date;
}

type StoredFields = Omit<FundReserveCoreSnapshot, "fetchedAt"> & { fetchedAt: FirestoreTimestampLike };

export interface FundReserveStore {
  get(fiscalYear: number, month: number): Promise<FundReserveCoreSnapshot | null>;
  save(snapshot: FundReserveCoreSnapshot): Promise<void>;
}

function toSnapshot(data: StoredFields): FundReserveCoreSnapshot {
  return { ...data, fetchedAt: data.fetchedAt.toDate() };
}

function createFirestoreStore(): FundReserveStore {
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

export async function getFundReserveSnapshot(
  fiscalYear: number,
  month: number,
  store: FundReserveStore = createFirestoreStore()
): Promise<FundReserveCoreSnapshot | null> {
  return store.get(fiscalYear, month);
}

export async function saveFundReserveSnapshot(
  snapshot: FundReserveCoreSnapshot,
  store: FundReserveStore = createFirestoreStore()
): Promise<void> {
  await store.save(snapshot);
}
