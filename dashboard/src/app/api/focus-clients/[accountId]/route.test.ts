import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const verifyIapJwtMock = vi.fn();
const saveFocusClientMock = vi.fn();

vi.mock("@/services/iap/verifyIapJwt", () => ({
  verifyIapJwt: verifyIapJwtMock,
}));
vi.mock("@/repositories/focusClientMasterRepository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/repositories/focusClientMasterRepository")>();
  return { ...actual, saveFocusClient: saveFocusClientMock };
});

const { PUT } = await import("./route");
const { FocusClientNotFoundError } = await import("@/repositories/focusClientMasterRepository");

const VALID_ID = "0015i00000AbCdEAAZ";

function put(accountId: string, body: unknown) {
  const request = new NextRequest(`http://localhost/api/focus-clients/${accountId}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return PUT(request, { params: Promise.resolve({ accountId }) });
}

afterEach(() => {
  verifyIapJwtMock.mockReset();
  saveFocusClientMock.mockReset();
});

describe("PUT /api/focus-clients/[accountId]", () => {
  it("returns 400 for a malformed account ID without checking IAP", async () => {
    const response = await put("bad-id", { fields: { theme: "x" } });
    expect(response.status).toBe(400);
    expect(verifyIapJwtMock).not.toHaveBeenCalled();
  });

  it("returns 403 when IAP verification fails", async () => {
    verifyIapJwtMock.mockResolvedValue({ ok: false, reason: "verification_failed" });
    const response = await put(VALID_ID, { fields: { theme: "x" } });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
    expect(saveFocusClientMock).not.toHaveBeenCalled();
  });

  it.each([
    ["unknown field", { fields: { name: "改名" } }],
    ["oversized text", { fields: { strategy: "x".repeat(2001) } }],
    ["Salesforce-owned field", { fields: { theme: "x" } }],
    ["owner", { fields: { owner: "x" } }],
    ["target", { fields: { memo: "x" }, target: { term: 50, sales: 1, grossProfit: 1 } }],
    ["empty body", {}],
  ])("returns 400 for %s", async (_label, body) => {
    verifyIapJwtMock.mockResolvedValue({ ok: true, email: "kawauchi@tcd.jp" });
    const response = await put(VALID_ID, body);
    expect(response.status).toBe(400);
    expect(saveFocusClientMock).not.toHaveBeenCalled();
  });

  it("saves with the verified email and returns the saved master", async () => {
    verifyIapJwtMock.mockResolvedValue({ ok: true, email: "kawauchi@tcd.jp" });
    saveFocusClientMock.mockResolvedValue({ accountId: VALID_ID });
    const response = await put(VALID_ID, { fields: { currentStatus: "提案中" } });
    expect(response.status).toBe(200);
    expect(saveFocusClientMock).toHaveBeenCalledWith({
      accountId: VALID_ID,
      updatedBy: "kawauchi@tcd.jp",
      fields: { currentStatus: "提案中" },
    });
  });

  it("returns 404 when the account is not a focus client in Salesforce", async () => {
    verifyIapJwtMock.mockResolvedValue({ ok: true, email: "kawauchi@tcd.jp" });
    saveFocusClientMock.mockRejectedValue(new FocusClientNotFoundError());
    const response = await put(VALID_ID, { fields: { memo: "x" } });
    expect(response.status).toBe(404);
  });
});
