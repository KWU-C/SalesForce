import { afterEach, describe, expect, it, vi } from "vitest";
import type { FreeeAuthStore, FreeeTokenRecord } from "./freeeAuthRepository";

const exchangeFreeeAuthorizationCodeMock = vi.fn();
const refreshFreeeTokenMock = vi.fn();

vi.mock("@/services/freee/freeeTokenClient", () => ({
  exchangeFreeeAuthorizationCode: exchangeFreeeAuthorizationCodeMock,
  refreshFreeeToken: refreshFreeeTokenMock,
}));

const {
  getFreeeConnectionStatus,
  connectFreeeWithAuthorizationCode,
  getValidFreeeAccessToken,
  FreeeNotConnectedError,
  FreeeRefreshInProgressError,
} = await import("./freeeAuthRepository");

function makeRecord(overrides: Partial<FreeeTokenRecord> = {}): FreeeTokenRecord {
  return {
    accessToken: "access-token",
    refreshToken: "refresh-token",
    accessTokenExpiresAt: new Date(Date.now() + 60 * 60_000),
    companyId: 12345,
    connectedBy: "kawauchi@tcd.jp",
    updatedAt: new Date(),
    ...overrides,
  };
}

/** テスト用フェイクストア。ロックの直列化はFirestoreトランザクションの代わりに単純なフラグで再現する */
function createFakeStore(initial: FreeeTokenRecord | null): FreeeAuthStore & { record: FreeeTokenRecord | null } {
  let record = initial;
  let lockedAt: Date | null = null;
  return {
    get record() {
      return record;
    },
    async get() {
      return record;
    },
    async saveTokens(next) {
      record = next;
      lockedAt = null;
    },
    async tryAcquireRefreshLock(now, ttlMs) {
      if (lockedAt && now.getTime() - lockedAt.getTime() < ttlMs) return false;
      lockedAt = now;
      return true;
    },
    async releaseRefreshLock() {
      lockedAt = null;
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  exchangeFreeeAuthorizationCodeMock.mockReset();
  refreshFreeeTokenMock.mockReset();
});

describe("getFreeeConnectionStatus", () => {
  it("reports not connected when no record exists", async () => {
    const status = await getFreeeConnectionStatus(createFakeStore(null));
    expect(status).toEqual({ connected: false });
  });

  it("reports connected with who connected and when, but never the token values", async () => {
    const record = makeRecord({ connectedBy: "tanaka@tcd.jp" });
    const status = await getFreeeConnectionStatus(createFakeStore(record));
    expect(status.connected).toBe(true);
    expect(status.connectedBy).toBe("tanaka@tcd.jp");
    expect(JSON.stringify(status)).not.toContain("access-token");
    expect(JSON.stringify(status)).not.toContain("refresh-token");
  });
});

describe("connectFreeeWithAuthorizationCode", () => {
  it("exchanges the code and saves the resulting tokens under the connecting email", async () => {
    exchangeFreeeAuthorizationCodeMock.mockResolvedValue({
      access_token: "new-access",
      refresh_token: "new-refresh",
      expires_in: 21600,
      company_id: 999,
    });
    const store = createFakeStore(null);

    await connectFreeeWithAuthorizationCode("the-code", "kawauchi@tcd.jp", store);

    expect(exchangeFreeeAuthorizationCodeMock).toHaveBeenCalledWith("the-code");
    expect(store.record).toMatchObject({
      accessToken: "new-access",
      refreshToken: "new-refresh",
      companyId: 999,
      connectedBy: "kawauchi@tcd.jp",
    });
  });
});

describe("getValidFreeeAccessToken", () => {
  it("throws FreeeNotConnectedError when nothing is stored", async () => {
    await expect(getValidFreeeAccessToken(createFakeStore(null))).rejects.toThrow(FreeeNotConnectedError);
  });

  it("returns the stored access token as-is when it is not close to expiring", async () => {
    const store = createFakeStore(makeRecord({ accessToken: "still-valid" }));

    const token = await getValidFreeeAccessToken(store);

    expect(token).toBe("still-valid");
    expect(refreshFreeeTokenMock).not.toHaveBeenCalled();
  });

  it("refreshes and saves when the access token is expiring soon", async () => {
    const store = createFakeStore(
      makeRecord({ accessToken: "expiring", accessTokenExpiresAt: new Date(Date.now() + 60_000) })
    );
    refreshFreeeTokenMock.mockResolvedValue({
      access_token: "refreshed-access",
      refresh_token: "refreshed-refresh",
      expires_in: 21600,
    });

    const token = await getValidFreeeAccessToken(store);

    expect(token).toBe("refreshed-access");
    expect(store.record?.refreshToken).toBe("refreshed-refresh");
  });

  it("does not call freee's refresh endpoint twice when a lock is already held (concurrent request race)", async () => {
    vi.useFakeTimers();
    try {
      const store = createFakeStore(
        makeRecord({ accessToken: "expiring", accessTokenExpiresAt: new Date(Date.now() + 60_000) })
      );
      // 先にロックを取得済みの状態を模倣(2つ目のリクエストが来た時点)
      await store.tryAcquireRefreshLock(new Date(), 30_000);

      const pending = expect(getValidFreeeAccessToken(store)).rejects.toThrow(FreeeRefreshInProgressError);
      await vi.runAllTimersAsync();
      await pending;
      expect(refreshFreeeTokenMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("releases the lock on refresh failure so a later request can retry", async () => {
    const store = createFakeStore(
      makeRecord({ accessToken: "expiring", accessTokenExpiresAt: new Date(Date.now() + 60_000) })
    );
    refreshFreeeTokenMock.mockRejectedValueOnce(new Error("refresh_token already used"));

    await expect(getValidFreeeAccessToken(store)).rejects.toThrow("refresh_token already used");

    // ロックが解放されているので、次の呼び出しは再度リフレッシュを試みられる
    refreshFreeeTokenMock.mockResolvedValueOnce({
      access_token: "recovered-access",
      refresh_token: "recovered-refresh",
      expires_in: 21600,
    });
    const token = await getValidFreeeAccessToken(store);
    expect(token).toBe("recovered-access");
  });
});
