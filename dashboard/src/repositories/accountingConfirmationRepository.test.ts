import { describe, expect, it } from "vitest";
import { getAccountingConfirmation, saveAccountingConfirmation } from "./accountingConfirmationRepository";
import type { AccountingConfirmationStore } from "./accountingConfirmationRepository";
import type { AccountingConfirmation } from "@/features/management-dashboard/accountingConfirmation";

function memoryStore(initial: unknown = null): AccountingConfirmationStore & { doc: unknown } {
  const store = {
    doc: initial,
    async read() {
      return store.doc;
    },
    async readModifyWrite(update: (current: unknown) => AccountingConfirmation) {
      store.doc = update(store.doc);
      return store.doc as AccountingConfirmation;
    },
  };
  return store;
}

describe("経理確認の対象月の保存", () => {
  it("上書き前の指定を履歴に残す。形が壊れた値は指定なしとして読む", async () => {
    const store = memoryStore();
    expect(await getAccountingConfirmation(store)).toBeNull();
    await saveAccountingConfirmation({ throughMonth: "2026-09", updatedBy: "a@tcd.jp", now: new Date("2026-11-16T01:00:00Z") }, store);
    const saved = await saveAccountingConfirmation(
      { throughMonth: null, updatedBy: "b@tcd.jp", now: new Date("2026-11-17T01:00:00Z") },
      store
    );
    expect(saved).toEqual({
      throughMonth: null,
      updatedBy: "b@tcd.jp",
      updatedAt: "2026-11-17T01:00:00.000Z",
      revisions: [{ throughMonth: "2026-09", updatedBy: "a@tcd.jp", updatedAt: "2026-11-16T01:00:00.000Z" }],
    });
    expect(await getAccountingConfirmation(memoryStore({ throughMonth: "9月" }))).toBeNull();
  });
});
