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
  get(processId: string): Promise<StoredDoc | null>;
  /** マージ書き込み（渡したフィールドだけを更新し、他のフィールドは残す） */
  save(processId: string, data: Record<string, unknown>): Promise<void>;
}

function createFirestoreProcessMemoStore(): ProcessMemoStore {
  return {
    async getAll() {
      const snapshot = await getFirestoreClient().collection(COLLECTION).get();
      return snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
    },
    async get(processId) {
      const doc = await getFirestoreClient().collection(COLLECTION).doc(processId).get();
      if (!doc.exists) return null;
      return { id: doc.id, data: doc.data() ?? {} };
    },
    async save(processId, data) {
      await getFirestoreClient().collection(COLLECTION).doc(processId).set(data, { merge: true });
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
    memo: (data.memo as string | undefined) ?? "",
    highlighted: (data.highlighted as boolean | undefined) ?? false,
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
  updatedBy: string;
  /** メモ本文の更新。省略時は既存の値を変更しない（チェックボックスのみの保存等） */
  memo?: string;
  /** 行ハイライトの更新。省略時は既存の値を変更しない（メモ本文のみの保存等） */
  highlighted?: boolean;
}

/**
 * ダッシュボード独自メモ(+行ハイライト)を1件保存する。
 * メモ本文とハイライトは別々のUI操作（メモは保存ボタン、ハイライトはチェックボックス
 * 即時保存）から独立して更新されるため、渡されたフィールドだけを更新するマージ書き込みにする
 * （どちらか一方だけの保存でもう一方を消してしまわないようにするため）。履歴は持たず常に
 * 最新値を上書き。
 *
 * updatedByは呼び出し元(APIルート)がIAP検証済みJWTから取り出した値を渡す前提で、
 * ここでは検証しない（クライアント入力のemailを混入させないのは呼び出し側の責務）。
 */
export async function saveProcessMemo(
  input: SaveProcessMemoInput,
  store: ProcessMemoStore = createFirestoreProcessMemoStore()
): Promise<ProcessMemo> {
  const updatedAt = new Date();
  const data: Record<string, unknown> = {
    processId: input.processId,
    crId: input.crId,
    updatedBy: input.updatedBy,
    updatedAt,
  };
  if (input.memo !== undefined) data.memo = input.memo;
  if (input.highlighted !== undefined) data.highlighted = input.highlighted;

  await store.save(input.processId, data);

  // マージ書き込み後の実際の内容を返す(渡していないフィールドの現在値を呼び出し側へ
  // 正しく伝えるため。書き込み直後なのでnullになることは通常想定しない)
  const saved = await store.get(input.processId);
  if (!saved) {
    throw new Error("saveProcessMemo: 保存直後のドキュメントが見つかりません");
  }
  return toProcessMemo(saved.id, saved.data);
}
