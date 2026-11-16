import { getFirestoreClient } from "@/services/firestore/firestoreClient";
import { parseStoredConfirmation } from "@/features/management-dashboard/accountingConfirmation";
import type { AccountingConfirmation } from "@/features/management-dashboard/accountingConfirmation";

/**
 * 経理確認の対象月(2026-11-16)。1ドキュメント(accountingConfirmations/current)に現在の指定を持ち、上書き前の
 * 指定は revisions に残す。金額は持たない。
 */
const COLLECTION = "accountingConfirmations";
const DOC_ID = "current";

export interface AccountingConfirmationStore {
  read(): Promise<unknown | null>;
  /** 読んでから書くまでを1トランザクションで行う */
  readModifyWrite(update: (current: unknown | null) => AccountingConfirmation): Promise<AccountingConfirmation>;
}

function createFirestoreStore(): AccountingConfirmationStore {
  return {
    async read() {
      const doc = await getFirestoreClient().collection(COLLECTION).doc(DOC_ID).get();
      return doc.exists ? (doc.data() ?? null) : null;
    },
    async readModifyWrite(update) {
      const db = getFirestoreClient();
      const ref = db.collection(COLLECTION).doc(DOC_ID);
      return db.runTransaction(async (tx) => {
        const doc = await tx.get(ref);
        const next = update(doc.exists ? (doc.data() ?? null) : null);
        tx.set(ref, next);
        return next;
      });
    },
  };
}

export async function getAccountingConfirmation(
  store: AccountingConfirmationStore = createFirestoreStore()
): Promise<AccountingConfirmation | null> {
  return parseStoredConfirmation(await store.read());
}

/** 対象月を指定(null=解除)する。updatedByはAPIルートがIAP検証済みJWTから渡す値 */
export async function saveAccountingConfirmation(
  input: { throughMonth: string | null; updatedBy: string; now?: Date },
  store: AccountingConfirmationStore = createFirestoreStore()
): Promise<AccountingConfirmation> {
  const at = (input.now ?? new Date()).toISOString();
  return store.readModifyWrite((raw) => {
    const current = parseStoredConfirmation(raw);
    return {
      throughMonth: input.throughMonth,
      updatedBy: input.updatedBy,
      updatedAt: at,
      revisions: current
        ? [
            ...current.revisions,
            { throughMonth: current.throughMonth, updatedBy: current.updatedBy, updatedAt: current.updatedAt },
          ]
        : [],
    };
  });
}
