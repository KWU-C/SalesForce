import type { FocusClientMaster, FocusClientTarget } from "@/features/focus-clients/focusClients";
import { getFirestoreClient } from "@/services/firestore/firestoreClient";
import { getSalesforceJwtConfig } from "@/config/salesforce";
import { SalesforceClient } from "@/services/salesforce/salesforceClient";
import { buildFocusAccountsQuery } from "@/services/salesforce/focusClientQueries";

/**
 * 注力クライアントのダッシュボード側の項目(営業戦略・状況・アクション・メモ・過去の期の目標)。
 * ドキュメントID = SalesforceのAccount ID(18桁)。一覧・会社名・区分・担当・テーマ・当期の目標は
 * Salesforce取引先が正で(ユーザー確定 2026-10-30)、ドキュメント内のname・category・owner・theme・active
 * (2026-10-15の初期投入時の値)は読まない。Salesforceへは書き戻さない。
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

/** Firestoreで持つ項目。Salesforce側の項目(会社名・区分・担当・テーマ・CR)は含まない */
export type FocusClientDashboardFields = Omit<FocusClientMaster, "name" | "category" | "theme" | "owner" | "crId">;

export function toFocusClientDashboardFields(id: string, data: Record<string, unknown>): FocusClientDashboardFields {
  const updatedAt = data.updatedAt as FirestoreTimestampLike | undefined;
  const memoUpdatedAt = data.memoUpdatedAt as FirestoreTimestampLike | undefined;
  return {
    accountId: id,
    strategy: str(data.strategy),
    currentStatus: str(data.currentStatus),
    monthAction: str(data.monthAction),
    nextAction: str(data.nextAction),
    memo: str(data.memo),
    memoUpdatedBy: typeof data.memoUpdatedBy === "string" ? data.memoUpdatedBy : null,
    memoUpdatedAt: memoUpdatedAt ? memoUpdatedAt.toDate().toISOString() : null,
    targets: toTargets(data.targets),
    updatedBy: typeof data.updatedBy === "string" ? data.updatedBy : null,
    updatedAt: updatedAt ? updatedAt.toDate().toISOString() : null,
  };
}

/** ダッシュボード側の項目を全件取得する(Account ID→項目)。Salesforceの一覧から外れた社のドキュメントも返る */
export async function getFocusClientDashboardFields(
  store: FocusClientMasterStore = createFirestoreStore()
): Promise<Map<string, FocusClientDashboardFields>> {
  const docs = await store.getAll();
  return new Map(docs.map((doc) => [doc.id, toFocusClientDashboardFields(doc.id, doc.data)]));
}

/** 画面から編集できる項目。区分・担当・テーマ・目標はSalesforce取引先で編集する */
export const EDITABLE_TEXT_FIELDS = [
  "strategy",
  "currentStatus",
  "monthAction",
  "nextAction",
  "memo",
] as const;

export type EditableTextField = (typeof EDITABLE_TEXT_FIELDS)[number];

export interface SaveFocusClientInput {
  accountId: string;
  updatedBy: string;
  fields: Partial<Record<EditableTextField, string>>;
}

export class FocusClientNotFoundError extends Error {}

/** Salesforceで注力・掘り起こしになっている取引先か */
async function isFocusAccountInSalesforce(accountId: string): Promise<boolean> {
  const client = new SalesforceClient(getSalesforceJwtConfig());
  return (await client.query<{ Id: string }>(buildFocusAccountsQuery(accountId))).length > 0;
}

/**
 * 1社分のダッシュボード側の項目を更新する。Salesforceで注力・掘り起こしになっている取引先だけが対象で、
 * ドキュメントが無ければ作る(Salesforce側で後から追加された社)。
 * updatedByは呼び出し元(APIルート)がIAP検証済みJWTから取り出した値を渡す前提。
 */
export async function saveFocusClient(
  input: SaveFocusClientInput,
  store: FocusClientMasterStore = createFirestoreStore(),
  isFocusAccount: (accountId: string) => Promise<boolean> = isFocusAccountInSalesforce
): Promise<FocusClientDashboardFields> {
  if (!(await isFocusAccount(input.accountId))) throw new FocusClientNotFoundError();

  const updatedAt = new Date();
  const data: Record<string, unknown> = { ...input.fields, updatedBy: input.updatedBy, updatedAt };
  // メモ専用の更新者・日時。一覧のメモ欄に表示する(他項目だけの保存では触らない)
  if (input.fields.memo !== undefined) {
    data.memoUpdatedBy = input.updatedBy;
    data.memoUpdatedAt = updatedAt;
  }
  await store.save(input.accountId, data);

  const saved = await store.get(input.accountId);
  if (!saved) throw new Error("saveFocusClient: 保存直後のドキュメントが見つかりません");
  return toFocusClientDashboardFields(saved.id, saved.data);
}
