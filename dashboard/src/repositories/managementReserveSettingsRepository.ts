import { getFirestoreClient } from "@/services/firestore/firestoreClient";
import { parseReserveSettings } from "@/features/management-dashboard/reserveSettings";
import type { ManagementReserveSettings } from "@/features/management-dashboard/reserveSettings";

// 経理が管理上決めている準備額・当座貸越枠(freeeから導出できないTCD独自の設定値)。
// ドキュメントIDは基準日(YYYY-MM-DD)。上書きせず基準日ごとに追加する。アプリからは読み取りのみで、
// 入力フォームはまだ無い(ユーザー確定、2026-10-05)。
const COLLECTION = "managementReserveSettings";

export interface ManagementReserveSettingsStore {
  listAll(): Promise<unknown[]>;
}

function createFirestoreStore(): ManagementReserveSettingsStore {
  return {
    async listAll() {
      const snapshot = await getFirestoreClient().collection(COLLECTION).get();
      return snapshot.docs.map((doc) => doc.data());
    },
  };
}

/** 全時点の設定を返す。形が不正なドキュメントは捨てる(その設定は無かったものとして扱う) */
export async function listManagementReserveSettings(
  store: ManagementReserveSettingsStore = createFirestoreStore()
): Promise<ManagementReserveSettings[]> {
  const docs = await store.listAll();
  return docs.map(parseReserveSettings).filter((s): s is ManagementReserveSettings => s !== null);
}
