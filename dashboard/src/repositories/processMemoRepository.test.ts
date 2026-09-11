import { describe, expect, it } from "vitest";
import {
  getAllProcessMemos,
  saveProcessMemo,
  type ProcessMemoStore,
} from "./processMemoRepository";

class FakeProcessMemoStore implements ProcessMemoStore {
  docs = new Map<string, Record<string, unknown>>();
  savedCalls: Array<{ processId: string; data: Record<string, unknown> }> = [];

  async getAll() {
    return [...this.docs.entries()].map(([id, data]) => ({ id, data }));
  }

  async save(processId: string, data: Record<string, unknown>) {
    this.savedCalls.push({ processId, data });
    this.docs.set(processId, data);
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
      updatedBy: "kawauchi@tcd.jp",
      updatedAt: fakeTimestamp("2026-09-01T01:23:45Z"),
    });

    const result = await getAllProcessMemos(store);

    expect(result).toEqual({
      a001: {
        processId: "a001",
        crId: "CR1",
        memo: "既存メモ",
        updatedBy: "kawauchi@tcd.jp",
        updatedAt: "2026-09-01T01:23:45.000Z",
      },
    });
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
});
