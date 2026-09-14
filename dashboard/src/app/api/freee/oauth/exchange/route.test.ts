import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const verifyIapJwtMock = vi.fn();
const connectFreeeWithAuthorizationCodeMock = vi.fn();

vi.mock("@/services/iap/verifyIapJwt", () => ({
  verifyIapJwt: verifyIapJwtMock,
}));
vi.mock("@/repositories/freeeAuthRepository", () => ({
  connectFreeeWithAuthorizationCode: connectFreeeWithAuthorizationCodeMock,
}));

const { POST } = await import("./route");

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/freee/oauth/exchange", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  verifyIapJwtMock.mockReset();
  connectFreeeWithAuthorizationCodeMock.mockReset();
});

describe("POST /api/freee/oauth/exchange", () => {
  it("returns 403 when IAP verification fails", async () => {
    verifyIapJwtMock.mockResolvedValue({ ok: false, reason: "verification_failed" });

    const response = await POST(makeRequest({ code: "abc" }));

    expect(response.status).toBe(403);
    expect(connectFreeeWithAuthorizationCodeMock).not.toHaveBeenCalled();
  });

  it("returns 403 when IAP verification succeeds but the email is not on the management dashboard allowlist", async () => {
    verifyIapJwtMock.mockResolvedValue({ ok: true, email: "someone-else@tcd.jp" });

    const response = await POST(makeRequest({ code: "abc" }));

    expect(response.status).toBe(403);
    expect(connectFreeeWithAuthorizationCodeMock).not.toHaveBeenCalled();
  });

  it("returns 400 for a missing or oversized code, after IAP+allowlist pass", async () => {
    verifyIapJwtMock.mockResolvedValue({ ok: true, email: "kawauchi@tcd.jp" });

    const missing = await POST(makeRequest({}));
    expect(missing.status).toBe(400);

    const oversized = await POST(makeRequest({ code: "x".repeat(501) }));
    expect(oversized.status).toBe(400);
    expect(connectFreeeWithAuthorizationCodeMock).not.toHaveBeenCalled();
  });

  it("exchanges the code using the IAP-verified email, never a client-supplied one", async () => {
    verifyIapJwtMock.mockResolvedValue({ ok: true, email: "tanaka@tcd.jp" });
    connectFreeeWithAuthorizationCodeMock.mockResolvedValue(undefined);

    const response = await POST(makeRequest({ code: "auth-code-123", connectedBy: "attacker@example.com" }));

    expect(response.status).toBe(200);
    expect(connectFreeeWithAuthorizationCodeMock).toHaveBeenCalledWith("auth-code-123", "tanaka@tcd.jp");
  });

  it("returns 502 without leaking details when the exchange fails", async () => {
    verifyIapJwtMock.mockResolvedValue({ ok: true, email: "yamasaki@tcd.jp" });
    connectFreeeWithAuthorizationCodeMock.mockRejectedValue(new Error("secret leak: refresh_token=abc"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(makeRequest({ code: "auth-code-123" }));

    expect(response.status).toBe(502);
    const body = await response.json();
    expect(JSON.stringify(body)).not.toContain("secret leak");
    expect(errorSpy.mock.calls.join(" ")).not.toContain("secret leak");
  });
});
