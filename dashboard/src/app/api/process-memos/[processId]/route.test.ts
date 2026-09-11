import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const verifyIapJwtMock = vi.fn();
const saveProcessMemoMock = vi.fn();

vi.mock("@/services/iap/verifyIapJwt", () => ({
  verifyIapJwt: verifyIapJwtMock,
}));
vi.mock("@/repositories/processMemoRepository", () => ({
  saveProcessMemo: saveProcessMemoMock,
}));

const { PUT } = await import("./route");

const VALID_PROCESS_ID = "a0X5i000004AbCdEAG";

function makeRequest(processId: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/process-memos/${processId}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PUT /api/process-memos/[processId]", () => {
  it("returns 400 for a malformed processId, without even checking IAP", async () => {
    const response = await PUT(makeRequest("not-a-salesforce-id", { crId: "CR1", memo: "x" }), {
      params: Promise.resolve({ processId: "not-a-salesforce-id" }),
    });

    expect(response.status).toBe(400);
    expect(verifyIapJwtMock).not.toHaveBeenCalled();
  });

  it("returns 403 when IAP verification fails, regardless of the reason (no detail leaked)", async () => {
    verifyIapJwtMock.mockResolvedValue({ ok: false, reason: "verification_failed" });

    const response = await PUT(makeRequest(VALID_PROCESS_ID, { crId: "CR1", memo: "x" }), {
      params: Promise.resolve({ processId: VALID_PROCESS_ID }),
    });

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toEqual({ error: "forbidden" });
    expect(saveProcessMemoMock).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid crId or an oversized memo, after IAP passes", async () => {
    verifyIapJwtMock.mockResolvedValue({ ok: true, email: "kawauchi@tcd.jp" });

    const badCr = await PUT(makeRequest(VALID_PROCESS_ID, { crId: "CR9", memo: "x" }), {
      params: Promise.resolve({ processId: VALID_PROCESS_ID }),
    });
    expect(badCr.status).toBe(400);

    const oversized = await PUT(
      makeRequest(VALID_PROCESS_ID, { crId: "CR1", memo: "x".repeat(2001) }),
      { params: Promise.resolve({ processId: VALID_PROCESS_ID }) }
    );
    expect(oversized.status).toBe(400);
    expect(saveProcessMemoMock).not.toHaveBeenCalled();
  });

  it("saves using the IAP-verified email, never a client-supplied one (request body has no email field at all)", async () => {
    verifyIapJwtMock.mockResolvedValue({ ok: true, email: "kawauchi@tcd.jp" });
    saveProcessMemoMock.mockResolvedValue({
      processId: VALID_PROCESS_ID,
      crId: "CR1",
      memo: "保存されたメモ",
      updatedBy: "kawauchi@tcd.jp",
      updatedAt: "2026-09-11T00:00:00.000Z",
    });

    const response = await PUT(
      makeRequest(VALID_PROCESS_ID, { crId: "CR1", memo: "保存されたメモ", email: "attacker@example.com" }),
      { params: Promise.resolve({ processId: VALID_PROCESS_ID }) }
    );

    expect(response.status).toBe(200);
    expect(saveProcessMemoMock).toHaveBeenCalledWith({
      processId: VALID_PROCESS_ID,
      crId: "CR1",
      memo: "保存されたメモ",
      updatedBy: "kawauchi@tcd.jp",
    });
    const body = await response.json();
    expect(body.updatedBy).toBe("kawauchi@tcd.jp");
  });

  it("returns 500 without leaking details when the Firestore write fails", async () => {
    verifyIapJwtMock.mockResolvedValue({ ok: true, email: "kawauchi@tcd.jp" });
    saveProcessMemoMock.mockRejectedValue(new Error("internal Firestore error, do not leak"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await PUT(makeRequest(VALID_PROCESS_ID, { crId: "CR1", memo: "x" }), {
      params: Promise.resolve({ processId: VALID_PROCESS_ID }),
    });

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(JSON.stringify(body)).not.toContain("internal Firestore error");
    expect(errorSpy.mock.calls.join(" ")).not.toContain("internal Firestore error");
  });
});
