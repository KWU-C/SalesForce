import type { ConcreteCrId, ProcessMemo } from "@/domain/types";
import { getFirestoreClient } from "@/services/firestore/firestoreClient";

const COLLECTION = "processMemos";

interface StoredDoc {
  id: string;
  data: Record<string, unknown>;
}

/**
 * Firestore Admin SDKへの最小アクセス面。DataSource層のSalesforceQueryClientと同じ
 * 発想で、テストではFirestoreの実体を使わずフェイクを注入できるようにする。
 */
export interface ProcessMemoStore {
  getAll(): Promise<StoredDoc[]>;
  save(processId: string, data: Record<string, unknown>): Promise<void>;
}

function createFirestoreProcessMemoStore(): ProcessMemoStore {
  return {
    async getAll() {
      const snapshot = await getFirestoreClient().collection(COLLECTION).get();
      return snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
    },
    async save(processId, data) {
      await getFirestoreClient().collection(COLLECTION).doc(processId).set(data);
    },
  };
}

interface FirestoreTimestampLike {
  toDate(): Date;
}

function toProcessMemo(id: string, data: Record<string, unknown>): ProcessMemo {
  return {
    processId: id,
    crId: data.crId as ConcreteCrId,
    memo: data.memo as string,
    updatedBy: data.updatedBy as string,
    updatedAt: (data.updatedAt as FirestoreTimestampLike).toDate().toISOString(),
  };
}

/**
 * 全案件分のダッシュボード独自メモを1回のクエリで取得する(SSRのページ描画時に呼ぶ想定)。
 * CRタブはクライアント側の状態切り替えのみで再取得しないため、Salesforceの
 * パイプライン一覧と同様に全CR分をまとめて取得しておく。
 */
export async function getAllProcessMemos(
  store: ProcessMemoStore = createFirestoreProcessMemoStore()
): Promise<Record<string, ProcessMemo>> {
  const docs = await store.getAll();
  const result: Record<string, ProcessMemo> = {};
  for (const doc of docs) {
    result[doc.id] = toProcessMemo(doc.id, doc.data);
  }
  return result;
}

export interface SaveProcessMemoInput {
  processId: string;
  crId: ConcreteCrId;
  memo: string;
  updatedBy: string;
}

/**
 * ダッシュボード独自メモを1件保存する（常に上書き、履歴は持たない。ユーザー確定）。
 * updatedByは呼び出し元(APIルート)がIAP検証済みJWTから取り出した値を渡す前提で、
 * ここでは検証しない（クライアント入力のemailを混入させないのは呼び出し側の責務）。
 */
export async function saveProcessMemo(
  input: SaveProcessMemoInput,
  store: ProcessMemoStore = createFirestoreProcessMemoStore()
): Promise<ProcessMemo> {
  const updatedAt = new Date();
  await store.save(input.processId, {
    processId: input.processId,
    crId: input.crId,
    memo: input.memo,
    updatedBy: input.updatedBy,
    updatedAt,
  });

  return {
    processId: input.processId,
    crId: input.crId,
    memo: input.memo,
    updatedBy: input.updatedBy,
    updatedAt: updatedAt.toISOString(),
  };
}
