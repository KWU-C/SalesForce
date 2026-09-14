import { getFirestoreClient } from "@/services/firestore/firestoreClient";
import { exchangeFreeeAuthorizationCode, refreshFreeeToken } from "@/services/freee/freeeTokenClient";

// processMemosとは別コレクション。ブラウザから直接アクセスさせず、Cloud Runサーバー側のみが
// 読み書きする(ユーザー確定、2026-09-14)。トークン本文は呼び出し元・ログにも一切出さない。
const COLLECTION = "freeeAuth";

// 同時に複数リクエストが期限切れを検知した場合でも、freeeのrefresh_token
// (使用のたびにローテーションする単発利用トークン)を二重に使ってしまわないよう、
// Firestoreトランザクションでロックを直列化する(ユーザー指摘、2026-09-14)。
const REFRESH_LOCK_TTL_MS = 30_000;
const REFRESH_WAIT_MS = 2_000;
// access_tokenの実際の失効(6時間)より前に余裕を持って更新する
const EXPIRY_SAFETY_MARGIN_MS = 5 * 60_000;

function getDocId(): string {
  const docId = process.env.FREEE_TOKEN_DOC_ID;
  if (!docId) {
    throw new Error("[freeeAuthRepository] FREEE_TOKEN_DOC_ID未設定です");
  }
  return docId;
}

export interface FreeeTokenRecord {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
  companyId: number | null;
  connectedBy: string;
  updatedAt: Date;
}

export interface FreeeConnectionStatus {
  connected: boolean;
  connectedBy?: string;
  updatedAt?: Date;
}

interface FirestoreTimestampLike {
  toDate(): Date;
}

interface StoredFields {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: FirestoreTimestampLike;
  companyId: number | null;
  connectedBy: string;
  updatedAt: FirestoreTimestampLike;
  refreshLockedAt?: FirestoreTimestampLike | null;
}

/**
 * Firestore Admin SDKへの最小アクセス面。テストでは実体を使わずフェイクを注入できるように
 * する(processMemoRepositoryと同じ方針)。
 */
export interface FreeeAuthStore {
  get(): Promise<FreeeTokenRecord | null>;
  saveTokens(record: FreeeTokenRecord): Promise<void>;
  /** ロック取得を試みる。直近ttlMs以内に他が取得済みならfalseを返す(トランザクションで直列化) */
  tryAcquireRefreshLock(now: Date, ttlMs: number): Promise<boolean>;
  /** リフレッシュ失敗時にロックを解放し、次のリクエストが再試行できるようにする */
  releaseRefreshLock(): Promise<void>;
}

function toRecord(data: StoredFields): FreeeTokenRecord {
  return {
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    accessTokenExpiresAt: data.accessTokenExpiresAt.toDate(),
    companyId: data.companyId,
    connectedBy: data.connectedBy,
    updatedAt: data.updatedAt.toDate(),
  };
}

function createFirestoreFreeeAuthStore(): FreeeAuthStore {
  const docRef = () => getFirestoreClient().collection(COLLECTION).doc(getDocId());
  return {
    async get() {
      const doc = await docRef().get();
      if (!doc.exists) return null;
      return toRecord(doc.data() as StoredFields);
    },
    async saveTokens(record) {
      await docRef().set(
        {
          accessToken: record.accessToken,
          refreshToken: record.refreshToken,
          accessTokenExpiresAt: record.accessTokenExpiresAt,
          companyId: record.companyId,
          connectedBy: record.connectedBy,
          updatedAt: record.updatedAt,
          refreshLockedAt: null,
        },
        { merge: true }
      );
    },
    async tryAcquireRefreshLock(now, ttlMs) {
      return getFirestoreClient().runTransaction(async (tx) => {
        const ref = docRef();
        const snap = await tx.get(ref);
        const data = snap.data() as Partial<StoredFields> | undefined;
        const lockedAt = data?.refreshLockedAt?.toDate();
        if (lockedAt && now.getTime() - lockedAt.getTime() < ttlMs) {
          return false;
        }
        tx.set(ref, { refreshLockedAt: now }, { merge: true });
        return true;
      });
    },
    async releaseRefreshLock() {
      await docRef().set({ refreshLockedAt: null }, { merge: true });
    },
  };
}

function isExpiringSoon(expiresAt: Date, now: Date): boolean {
  return expiresAt.getTime() - now.getTime() <= EXPIRY_SAFETY_MARGIN_MS;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getFreeeConnectionStatus(
  store: FreeeAuthStore = createFirestoreFreeeAuthStore()
): Promise<FreeeConnectionStatus> {
  const record = await store.get();
  if (!record) return { connected: false };
  return { connected: true, connectedBy: record.connectedBy, updatedAt: record.updatedAt };
}

/**
 * freeeの認可コードを引き換え、初回接続(または再接続)としてトークンを保存する。
 * connectedByは呼び出し元(APIルート)がIAP検証済みJWTから取り出した値を渡す前提で、
 * ここでは検証しない(クライアント入力のemailを混入させないのは呼び出し側の責務)。
 */
export async function connectFreeeWithAuthorizationCode(
  code: string,
  connectedBy: string,
  store: FreeeAuthStore = createFirestoreFreeeAuthStore()
): Promise<void> {
  const now = new Date();
  const tokenResponse = await exchangeFreeeAuthorizationCode(code);
  await store.saveTokens({
    accessToken: tokenResponse.access_token,
    refreshToken: tokenResponse.refresh_token,
    accessTokenExpiresAt: new Date(now.getTime() + tokenResponse.expires_in * 1000),
    companyId: tokenResponse.company_id ?? null,
    connectedBy,
    updatedAt: now,
  });
}

export class FreeeNotConnectedError extends Error {
  constructor() {
    super("freee_not_connected");
  }
}

export class FreeeRefreshInProgressError extends Error {
  constructor() {
    super("freee_refresh_in_progress");
  }
}

/**
 * 有効なaccess_tokenを返す。期限が近い場合は自動更新する。
 * 複数リクエストが同時に期限切れを検知しても、Firestoreトランザクションによるロックで
 * refresh_tokenの二重使用(freee側は単発利用トークンのため片方が必ず失敗する)を防ぐ。
 * ロックを取れなかった場合は、先行リクエストの更新完了を少し待ってから再読込する。
 */
export async function getValidFreeeAccessToken(
  store: FreeeAuthStore = createFirestoreFreeeAuthStore()
): Promise<string> {
  const record = await store.get();
  if (!record) {
    throw new FreeeNotConnectedError();
  }

  const now = new Date();
  if (!isExpiringSoon(record.accessTokenExpiresAt, now)) {
    return record.accessToken;
  }

  const gotLock = await store.tryAcquireRefreshLock(now, REFRESH_LOCK_TTL_MS);
  if (gotLock) {
    try {
      const fresh = await refreshFreeeToken(record.refreshToken);
      const saved: FreeeTokenRecord = {
        accessToken: fresh.access_token,
        refreshToken: fresh.refresh_token,
        accessTokenExpiresAt: new Date(Date.now() + fresh.expires_in * 1000),
        companyId: record.companyId,
        connectedBy: record.connectedBy,
        updatedAt: new Date(),
      };
      await store.saveTokens(saved);
      return saved.accessToken;
    } catch (error) {
      await store.releaseRefreshLock();
      throw error;
    }
  }

  await sleep(REFRESH_WAIT_MS);
  const latest = await store.get();
  if (latest && !isExpiringSoon(latest.accessTokenExpiresAt, new Date())) {
    return latest.accessToken;
  }
  throw new FreeeRefreshInProgressError();
}
