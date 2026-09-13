import { describe, expect, it } from "vitest";
import {
  getAllProcessMemos,
  saveProcessMemo,
  type ProcessMemoStore,
} from "./processMemoRepository";

/** save()はFirestore側と同じくマージ書き込みを模倣する(既存フィールドを消さない) */
class FakeProcessMemoStore implements ProcessMemoStore {
  docs = new Map<string, Record<string, unknown>>();
  savedCalls: Array<{ processId: string; data: Record<string, unknown> }> = [];

  async getAll() {
    return [...this.docs.entries()].map(([id, data]) => ({ id, data }));
  }

  async get(processId: string) {
    const data = this.docs.get(processId);
    return data ? { id: processId, data } : null;
  }

  async save(processId: string, data: Record<string, unknown>) {
    this.savedCalls.push({ processId, data });
    // 実際のFirestoreはDateを書き込むとTimestamp(.toDate()を持つ)として読み出せる。
    // フェイクでも同じ往復を再現する
    const normalized = { ...data };
    if (normalized.updatedAt instanceof Date) {
      const date = normalized.updatedAt;
      normalized.updatedAt = { toDate: () => date };
    }
    this.docs.set(processId, { ...(this.docs.get(processId) ?? {}), ...normalized });
  }
}

function fakeTimestamp(isoDate: string) {
  return { toDate: () => new Date(isoDate) };
}

describe("getAllProcessMemos", () => {
  it("converts every document, keyed by processId, into a ProcessMemo", async () => {
    const store = new FakeProcessMemoStore();
    store.docs.set("a001", {
      crId: "CR1",
      memo: "既存メモ",
      highlighted: true,
      updatedBy: "kawauchi@tcd.jp",
      updatedAt: fakeTimestamp("2026-09-01T01:23:45Z"),
    });

    const result = await getAllProcessMemos(store);

    expect(result).toEqual({
      a001: {
        processId: "a001",
        crId: "CR1",
        memo: "既存メモ",
        highlighted: true,
        updatedBy: "kawauchi@tcd.jp",
        updatedAt: "2026-09-01T01:23:45.000Z",
      },
    });
  });

  it('defaults a missing memo/highlighted to ""/false (older or partial writes)', async () => {
    const store = new FakeProcessMemoStore();
    store.docs.set("a002", {
      crId: "CR1",
      updatedBy: "kawauchi@tcd.jp",
      updatedAt: fakeTimestamp("2026-09-01T01:23:45Z"),
    });

    const result = await getAllProcessMemos(store);

    expect(result.a002.memo).toBe("");
    expect(result.a002.highlighted).toBe(false);
  });

  it("returns an empty object when the collection is empty", async () => {
    const result = await getAllProcessMemos(new FakeProcessMemoStore());
    expect(result).toEqual({});
  });
});

describe("saveProcessMemo", () => {
  it("overwrites (not appends) and stamps updatedBy/updatedAt from the input, never a client-supplied value", async () => {
    const store = new FakeProcessMemoStore();

    const saved = await saveProcessMemo(
      { processId: "a001", crId: "CR2", memo: "新しいメモ", updatedBy: "kawauchi@tcd.jp" },
      store
    );

    expect(saved.processId).toBe("a001");
    expect(saved.crId).toBe("CR2");
    expect(saved.memo).toBe("新しいメモ");
    expect(saved.updatedBy).toBe("kawauchi@tcd.jp");
    expect(new Date(saved.updatedAt).getTime()).not.toBeNaN();

    expect(store.savedCalls).toHaveLength(1);
    expect(store.savedCalls[0].processId).toBe("a001");
    expect(store.savedCalls[0].data.memo).toBe("新しいメモ");
  });

  it("saving only highlighted does not clear a previously saved memo (merge write)", async () => {
    const store = new FakeProcessMemoStore();
    await saveProcessMemo(
      { processId: "a001", crId: "CR1", memo: "既存メモ", updatedBy: "kawauchi@tcd.jp" },
      store
    );

    const saved = await saveProcessMemo(
      { processId: "a001", crId: "CR1", highlighted: true, updatedBy: "kawauchi@tcd.jp" },
      store
    );

    expect(saved.memo).toBe("既存メモ");
    expect(saved.highlighted).toBe(true);
  });

  it("saving only memo does not clear a previously saved highlighted flag (merge write)", async () => {
    const store = new FakeProcessMemoStore();
    await saveProcessMemo(
      { processId: "a001", crId: "CR1", highlighted: true, updatedBy: "kawauchi@tcd.jp" },
      store
    );

    const saved = await saveProcessMemo(
      { processId: "a001", crId: "CR1", memo: "後から追加したメモ", updatedBy: "kawauchi@tcd.jp" },
      store
    );

    expect(saved.highlighted).toBe(true);
    expect(saved.memo).toBe("後から追加したメモ");
  });
});
