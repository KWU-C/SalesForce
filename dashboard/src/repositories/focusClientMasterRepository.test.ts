import { describe, expect, it } from "vitest";
import { FocusClientNotFoundError, saveFocusClient } from "./focusClientMasterRepository";
import type { FocusClientMasterStore } from "./focusClientMasterRepository";

function memoryStore(initial: Record<string, Record<string, unknown>> = {}): FocusClientMasterStore {
  const docs = new Map(Object.entries(initial));
  return {
    async getAll() {
      return [...docs].map(([id, data]) => ({ id, data }));
    },
    async get(id) {
      const data = docs.get(id);
      return data ? { id, data } : null;
    },
    // Firestoreと同じく、保存したDateは読み出し時にTimestamp(toDateを持つ値)で返す
    async save(id, data) {
      const stored = Object.fromEntries(
        Object.entries(data).map(([key, value]) => [key, value instanceof Date ? { toDate: () => value } : value])
      );
      docs.set(id, { ...docs.get(id), ...stored });
    },
  };
}

const ID = "001000000000001AAA";

describe("saveFocusClient", () => {
  it("Salesforceで注力クライアントでない取引先は保存しない", async () => {
    const store = memoryStore();
    await expect(
      saveFocusClient({ accountId: ID, updatedBy: "kawauchi@tcd.jp", fields: { memo: "x" } }, store, async () => false)
    ).rejects.toBeInstanceOf(FocusClientNotFoundError);
    expect(await store.get(ID)).toBeNull();
  });

  it("ドキュメントが無い社(Salesforceで後から追加された社)は新しく作る", async () => {
    const saved = await saveFocusClient(
      { accountId: ID, updatedBy: "kawauchi@tcd.jp", fields: { memo: "x" } },
      memoryStore(),
      async () => true
    );
    expect(saved).toMatchObject({ accountId: ID, memo: "x", memoUpdatedBy: "kawauchi@tcd.jp", updatedBy: "kawauchi@tcd.jp" });
  });
});
