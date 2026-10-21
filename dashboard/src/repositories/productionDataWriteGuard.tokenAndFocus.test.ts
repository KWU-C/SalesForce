import { afterEach, describe, expect, it, vi } from "vitest";
import { ProductionDataWriteBlockedError, canWriteFreeeTokenDocument } from "@/services/firestore/productionDataWriteGuard";

// 読み取りは成功し、書き込みが呼ばれたら記録するFirestoreの偽物
const writes = vi.fn();
vi.mock("@/services/firestore/firestoreClient", () => ({
  getFirestoreClient: () => ({
    collection: () => ({
      doc: () => ({
        get: async () => ({ exists: true, id: "001000000000001AAA", data: () => ({ accountId: "001000000000001AAA", category: "focus" }) }),
        set: async (...args: unknown[]) => writes(...args),
      }),
    }),
  }),
}));
vi.mock("@/services/freee/freeeTokenClient", () => ({
  exchangeFreeeAuthorizationCode: async () => ({ access_token: "a", refresh_token: "r", expires_in: 21600, company_id: 1 }),
  refreshFreeeToken: async () => {
    throw new Error("not used");
  },
}));

const { saveFocusClient } = await import("./focusClientMasterRepository");
const { connectFreeeWithAuthorizationCode } = await import("./freeeAuthRepository");

const ORIGINAL = { ...process.env };
afterEach(() => {
  process.env = { ...ORIGINAL };
  writes.mockReset();
});

describe("注力クライアントのマスタ", () => {
  it("is not written from dev2", async () => {
    process.env.K_SERVICE = "tcd-dashboard-dev2";
    await expect(saveFocusClient({ accountId: "001000000000001AAA", updatedBy: "tester@example.com", fields: { memo: "x" } } as never)).rejects.toBeInstanceOf(
      ProductionDataWriteBlockedError
    );
    expect(writes).not.toHaveBeenCalled();
  });
});

describe("freeeトークン: 自分の環境のドキュメントだけ書ける", () => {
  it("lets dev2 write its own token document", async () => {
    process.env.K_SERVICE = "tcd-dashboard-dev2";
    process.env.FREEE_TOKEN_DOC_ID = "tcd-dashboard-dev2";
    await connectFreeeWithAuthorizationCode("code", "tester@example.com");
    expect(writes).toHaveBeenCalledTimes(1);
  });

  it("blocks dev2 from writing the production token document", async () => {
    process.env.K_SERVICE = "tcd-dashboard-dev2";
    process.env.FREEE_TOKEN_DOC_ID = "tcd-dashboard-prod";
    await expect(connectFreeeWithAuthorizationCode("code", "tester@example.com")).rejects.toBeInstanceOf(ProductionDataWriteBlockedError);
    expect(writes).not.toHaveBeenCalled();
  });

  it("maps each job to its own service document only", () => {
    const job = (name: string) => ({ service: undefined, job: name, localOverride: undefined });
    expect(canWriteFreeeTokenDocument("tcd-dashboard-prod", job("tcd-dashboard-prod-finance-refresh"))).toBe(true);
    expect(canWriteFreeeTokenDocument("tcd-dashboard-prod", job("tcd-dashboard-dev2-finance-refresh"))).toBe(false);
    expect(canWriteFreeeTokenDocument("tcd-dashboard-dev2", job("tcd-dashboard-dev2-finance-refresh"))).toBe(true);
    expect(canWriteFreeeTokenDocument("tcd-dashboard-prod", job("tcd-dashboard-prod"))).toBe(false);
    expect(canWriteFreeeTokenDocument("tcd-dashboard-prod", { service: "tcd-dashboard-prod", job: undefined, localOverride: undefined })).toBe(true);
    expect(canWriteFreeeTokenDocument("tcd-dashboard-prod", { service: undefined, job: undefined, localOverride: undefined })).toBe(false);
  });
});
