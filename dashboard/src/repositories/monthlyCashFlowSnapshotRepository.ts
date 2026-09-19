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
      // 外部入金・外部支出の恒久ロジックのバージョン(externalCashFlow.ts の
      // EXTERNAL_CASH_FLOW_CALCULATION_VERSION)が保存済みスナップショットと異なっていても、
      // ここでは捨てずにそのまま返す。旧ロジックの値であることはcalculationVersionで判別でき、
      // UIが「旧ロジック」と表示する。入金側v3(2026-09-19)以降、再計算は仕訳帳の非同期エクスポートを
      // 伴い重いため、ページ表示時に自動再計算せず、更新操作(定時Job/「更新」ボタン/
      // 「この期をfreeeから更新」)で再計算する(v2まではキャッシュミス扱いで自動再計算していた)
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
