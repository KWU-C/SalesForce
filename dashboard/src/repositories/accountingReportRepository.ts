import { getFirestoreClient } from "@/services/firestore/firestoreClient";
import { ALLOWED_OVERWRITE_TYPES } from "@/features/management-dashboard/accountingReports";
import type {
  AccountingReportKind,
  CashPlan,
  ChangeType,
  MonthlyReport,
  ReportValues,
  Revision,
  StoredReport,
} from "@/features/management-dashboard/accountingReports";

/**
 * 経理月次報告・資金繰り予定(ユーザー確定、2026-10-15)。ドキュメントID=対象月(YYYY-MM)。
 * 実額はFirestoreにだけ置く。アプリから削除はしない(誤登録は訂正で直す)。
 */
const COLLECTIONS: Record<AccountingReportKind, string> = {
  "monthly-report": "accountingMonthlyReports",
  "cash-plan": "cashPlanForecasts",
};

/** 保存形式。日時はFirestoreのTimestampではなくISO文字列で持つ(履歴配列の中でも同じ形にするため) */
type StoredDoc = StoredReport<Record<string, unknown>>;

export interface AccountingReportStore {
  listAll(kind: AccountingReportKind): Promise<unknown[]>;
  /** 対象ドキュメントを読み、update(現在値)の結果を書き込む。読んでから書くまでを1トランザクションで行う */
  readModifyWrite(
    kind: AccountingReportKind,
    targetMonth: string,
    update: (current: unknown | null) => StoredDoc
  ): Promise<StoredDoc>;
}

function createFirestoreStore(): AccountingReportStore {
  return {
    async listAll(kind) {
      const snapshot = await getFirestoreClient().collection(COLLECTIONS[kind]).get();
      return snapshot.docs.map((doc) => doc.data());
    },
    async readModifyWrite(kind, targetMonth, update) {
      const db = getFirestoreClient();
      const ref = db.collection(COLLECTIONS[kind]).doc(targetMonth);
      return db.runTransaction(async (tx) => {
        const doc = await tx.get(ref);
        const next = update(doc.exists ? (doc.data() ?? null) : null);
        tx.set(ref, next);
        return next;
      });
    },
  };
}

function isStoredDoc(data: unknown): data is StoredDoc {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.targetMonth === "string" &&
    typeof d.values === "object" &&
    d.values !== null &&
    typeof d.updatedBy === "string" &&
    typeof d.updatedAt === "string" &&
    Array.isArray(d.revisions)
  );
}

async function listReports<V>(kind: AccountingReportKind, store: AccountingReportStore): Promise<StoredReport<V>[]> {
  const docs = await store.listAll(kind);
  // 形が壊れたドキュメントは表示しない(手作業で入れた値などを推測で読まない)
  return docs.filter(isStoredDoc) as unknown as StoredReport<V>[];
}

export function listMonthlyReports(store: AccountingReportStore = createFirestoreStore()): Promise<MonthlyReport[]> {
  return listReports("monthly-report", store);
}

export function listCashPlans(store: AccountingReportStore = createFirestoreStore()): Promise<CashPlan[]> {
  return listReports("cash-plan", store);
}

export class ChangeTypeRequiredError extends Error {}

export interface SaveAccountingReportInput<K extends AccountingReportKind> {
  kind: K;
  targetMonth: string;
  values: ReportValues<K>;
  /** 既存の値を上書きする場合の理由。新規登録では無視する */
  changeType?: ChangeType;
  updatedBy: string;
  now?: Date;
}

/**
 * 1か月分を登録・上書きする。既存の値がある場合は、上書き前の値・登録者・日時を履歴に追加し、
 * 理由(訂正/予測更新)を必須にする。無い場合は初回登録。読み込みと書き込みは1トランザクションで
 * 行い、同時保存で履歴が欠けないようにする。updatedByはAPIルートがIAP検証済みJWTから渡す値。
 */
export async function saveAccountingReport<K extends AccountingReportKind>(
  input: SaveAccountingReportInput<K>,
  store: AccountingReportStore = createFirestoreStore()
): Promise<StoredReport<ReportValues<K>>> {
  const at = (input.now ?? new Date()).toISOString();
  const saved = await store.readModifyWrite(input.kind, input.targetMonth, (current) => {
    const values = input.values as unknown as Record<string, unknown>;
    if (current === null || !isStoredDoc(current)) {
      return {
        targetMonth: input.targetMonth,
        values,
        changeType: "initial",
        createdBy: input.updatedBy,
        createdAt: at,
        updatedBy: input.updatedBy,
        updatedAt: at,
        revisions: [],
      };
    }
    const changeType = input.changeType;
    if (!changeType || !ALLOWED_OVERWRITE_TYPES[input.kind].includes(changeType)) {
      throw new ChangeTypeRequiredError();
    }
    const revision: Revision<Record<string, unknown>> = {
      values: current.values,
      previousUpdatedBy: current.updatedBy,
      previousUpdatedAt: current.updatedAt,
      changeType,
      changedBy: input.updatedBy,
      changedAt: at,
    };
    return {
      ...current,
      values,
      changeType,
      updatedBy: input.updatedBy,
      updatedAt: at,
      revisions: [...current.revisions, revision],
    };
  });
  return saved as unknown as StoredReport<ReportValues<K>>;
}
