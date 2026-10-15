import type { FocusClientMaster, FocusClientTarget } from "@/features/focus-clients/focusClients";
import { getFirestoreClient } from "@/services/firestore/firestoreClient";

/**
 * 注力クライアントマスタ(ダッシュボード側が正本、ユーザー確定 2026-10-15)。
 * ドキュメントID = SalesforceのAccount ID(18桁)。初期データはAccount(ターゲット区分=注力)から
 * 一度だけ投入し、以後はダッシュボードの画面から編集する(Salesforceへは書き戻さない)。
 */
const COLLECTION = "focusClients";

interface StoredDoc {
  id: string;
  data: Record<string, unknown>;
}

/** processMemoRepositoryと同じく、テストでフェイクを注入できる最小アクセス面 */
export interface FocusClientMasterStore {
  getAll(): Promise<StoredDoc[]>;
  get(accountId: string): Promise<StoredDoc | null>;
  /** マージ書き込み(渡したフィールドだけを更新。targetsは期ごとのキー単位でマージされる) */
  save(accountId: string, data: Record<string, unknown>): Promise<void>;
}

function createFirestoreStore(): FocusClientMasterStore {
  return {
    async getAll() {
      const snapshot = await getFirestoreClient().collection(COLLECTION).get();
      return snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
    },
    async get(accountId) {
      const doc = await getFirestoreClient().collection(COLLECTION).doc(accountId).get();
      if (!doc.exists) return null;
      return { id: doc.id, data: doc.data() ?? {} };
    },
    async save(accountId, data) {
      await getFirestoreClient().collection(COLLECTION).doc(accountId).set(data, { merge: true });
    },
  };
}

interface FirestoreTimestampLike {
  toDate(): Date;
}

const str = (value: unknown) => (typeof value === "string" ? value : "");
const amount = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);

function toTargets(value: unknown): Record<string, FocusClientTarget> {
  if (typeof value !== "object" || value === null) return {};
  const result: Record<string, FocusClientTarget> = {};
  for (const [term, raw] of Object.entries(value as Record<string, unknown>)) {
    const t = (raw ?? {}) as Record<string, unknown>;
    result[term] = { sales: amount(t.sales), grossProfit: amount(t.grossProfit) };
  }
  return result;
}

export function toFocusClientMaster(id: string, data: Record<string, unknown>): FocusClientMaster {
  const updatedAt = data.updatedAt as FirestoreTimestampLike | undefined;
  return {
    accountId: id,
    name: str(data.name),
    category: str(data.category),
    theme: str(data.theme),
    owner: str(data.owner),
    strategy: str(data.strategy),
    currentStatus: str(data.currentStatus),
    monthAction: str(data.monthAction),
    nextAction: str(data.nextAction),
    targets: toTargets(data.targets),
    updatedBy: typeof data.updatedBy === "string" ? data.updatedBy : null,
    updatedAt: updatedAt ? updatedAt.toDate().toISOString() : null,
  };
}

/** 有効な(active=falseでない)注力クライアントを全件取得する。並びは名称順 */
export async function getFocusClientMasters(
  store: FocusClientMasterStore = createFirestoreStore()
): Promise<FocusClientMaster[]> {
  const docs = await store.getAll();
  return docs
    .filter((doc) => doc.data.active !== false)
    .map((doc) => toFocusClientMaster(doc.id, doc.data))
    .sort((a, b) => a.name.localeCompare(b.name, "ja"));
}

/** 画面から編集できる項目。会社名・Account IDは変更させない(Salesforceとの突合キーのため) */
export const EDITABLE_TEXT_FIELDS = [
  "category",
  "theme",
  "owner",
  "strategy",
  "currentStatus",
  "monthAction",
  "nextAction",
] as const;

export type EditableTextField = (typeof EDITABLE_TEXT_FIELDS)[number];

export interface SaveFocusClientInput {
  accountId: string;
  updatedBy: string;
  fields: Partial<Record<EditableTextField, string>>;
  /** 指定した期の目標だけを更新する(他の期の目標は残す) */
  target?: { term: number; sales: number | null; grossProfit: number | null };
}

export class FocusClientNotFoundError extends Error {}

/**
 * マスタ1社分を更新する。新規作成はしない(注力対象の追加・除外は初期投入スクリプトで行う)。
 * updatedByは呼び出し元(APIルート)がIAP検証済みJWTから取り出した値を渡す前提。
 */
export async function saveFocusClient(
  input: SaveFocusClientInput,
  store: FocusClientMasterStore = createFirestoreStore()
): Promise<FocusClientMaster> {
  const existing = await store.get(input.accountId);
  if (!existing) throw new FocusClientNotFoundError();

  const data: Record<string, unknown> = { ...input.fields, updatedBy: input.updatedBy, updatedAt: new Date() };
  if (input.target) {
    data.targets = {
      [String(input.target.term)]: { sales: input.target.sales, grossProfit: input.target.grossProfit },
    };
  }
  await store.save(input.accountId, data);

  const saved = await store.get(input.accountId);
  if (!saved) throw new Error("saveFocusClient: 保存直後のドキュメントが見つかりません");
  return toFocusClientMaster(saved.id, saved.data);
}
