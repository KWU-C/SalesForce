import { getFirestoreClient } from "@/services/firestore/firestoreClient";
import { PRODUCTION_DATABASE_ID, resolveFirestoreDatabaseId } from "@/services/firestore/databaseId";
import { assertProductionDataWritable, DEV_DATABASE_ID } from "@/services/firestore/productionDataWriteGuard";
import {
  isReferenceForecastEnabled,
  validateReferenceForecastRecord,
  type ReferenceForecastRecord,
} from "@/features/management-dashboard/referenceForecast";

/**
 * 資金・損益の参考予測の保存先(2026-11-17、本番でも使用 2026-11-19)。
 * - referenceForecasts/{基準日}_{作成日時}: 1回の計算＝1件。create で追加し、同じIDがあれば失敗させる(上書きしない)
 * - 書き込めるのは本番(dashboard)とdev(dashboard-dev)だけ。どちらに書けるかは書き込みガード
 *   (assertProductionDataWritable: 本番のサービス→dashboard、dev2→dashboard-dev)で決まる。DEVの記録は本番へ移さない
 */
export const REFERENCE_FORECASTS = "referenceForecasts";

export interface ReferenceForecastStore {
  create(id: string, doc: ReferenceForecastRecord): Promise<void>;
  getLatest(): Promise<ReferenceForecastRecord | null>;
}

function createFirestoreStore(): ReferenceForecastStore {
  return {
    async create(id, doc) {
      await getFirestoreClient().collection(REFERENCE_FORECASTS).doc(id).create(JSON.parse(JSON.stringify(doc)));
    },
    async getLatest() {
      const snap = await getFirestoreClient().collection(REFERENCE_FORECASTS).orderBy("createdAt", "desc").limit(1).get();
      return snap.empty ? null : (snap.docs[0].data() as ReferenceForecastRecord);
    },
  };
}

export class ReferenceForecastWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReferenceForecastWriteError";
  }
}

/** 記録を1件追加する。本番・dev以外のデータベース、実行環境と接続先の組み合わせが許可されていない場合、形の崩れた記録は書かずに止める。既にあるIDは上書きしない(Firestoreのcreateが失敗する) */
export async function addReferenceForecast(
  doc: ReferenceForecastRecord,
  store: ReferenceForecastStore = createFirestoreStore(),
  databaseId: string = resolveFirestoreDatabaseId()
): Promise<void> {
  if (databaseId !== DEV_DATABASE_ID && databaseId !== PRODUCTION_DATABASE_ID) {
    throw new ReferenceForecastWriteError(`参考予測は ${PRODUCTION_DATABASE_ID}・${DEV_DATABASE_ID} にだけ保存します(接続先: ${databaseId})`);
  }
  assertProductionDataWritable(REFERENCE_FORECASTS);
  const errors = validateReferenceForecastRecord(doc);
  if (errors.length > 0) throw new ReferenceForecastWriteError(`記録の検査で止めました: ${errors.join(" / ")}`);
  await store.create(doc.id, doc);
}

/** 最新の記録。本番・dev以外のデータベースでは読まずに null を返す */
export async function getLatestReferenceForecast(
  store: ReferenceForecastStore = createFirestoreStore(),
  databaseId: string = resolveFirestoreDatabaseId()
): Promise<ReferenceForecastRecord | null> {
  if (!isReferenceForecastEnabled(databaseId)) return null;
  return store.getLatest();
}
