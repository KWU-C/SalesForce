import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const verifyIapJwtMock = vi.fn();
const getOrComputeTermCashFlowTotalMock = vi.fn();

vi.mock("@/services/iap/verifyIapJwt", () => ({
  verifyIapJwt: verifyIapJwtMock,
}));
vi.mock("@/features/management-dashboard/termCashFlowTotalService", () => ({
  getOrComputeTermCashFlowTotal: getOrComputeTermCashFlowTotalMock,
}));

const { POST } = await import("./route");

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/freee/monthly-finance/refresh-term", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  verifyIapJwtMock.mockReset();
  getOrComputeTermCashFlowTotalMock.mockReset();
});

describe("POST /api/freee/monthly-finance/refresh-term", () => {
  it("returns 403 when IAP verification fails or the email is not on the allowlist", async () => {
    verifyIapJwtMock.mockResolvedValue({ ok: false, reason: "verification_failed" });
    const response = await POST(makeRequest({ term: 49 }));
    expect(response.status).toBe(403);
    expect(getOrComputeTermCashFlowTotalMock).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid body", async () => {
    verifyIapJwtMock.mockResolvedValue({ ok: true, email: "kawauchi@tcd.jp" });
    const response = await POST(makeRequest({ term: "49" }));
    expect(response.status).toBe(400);
  });

  it("force-refreshes the given term and returns ok", async () => {
    verifyIapJwtMock.mockResolvedValue({ ok: true, email: "kawauchi@tcd.jp" });
    getOrComputeTermCashFlowTotalMock.mockResolvedValue({ term: 49 });

    const response = await POST(makeRequest({ term: 49 }));

    expect(response.status).toBe(200);
    expect(getOrComputeTermCashFlowTotalMock).toHaveBeenCalledWith(49, { forceRefresh: true });
  });

  it("returns 409 when freee is not connected", async () => {
    verifyIapJwtMock.mockResolvedValue({ ok: true, email: "kawauchi@tcd.jp" });
    getOrComputeTermCashFlowTotalMock.mockResolvedValue(null);

    const response = await POST(makeRequest({ term: 49 }));

    expect(response.status).toBe(409);
  });

  it("returns 502 without leaking details when the computation fails", async () => {
    verifyIapJwtMock.mockResolvedValue({ ok: true, email: "kawauchi@tcd.jp" });
    getOrComputeTermCashFlowTotalMock.mockRejectedValue(new Error("secret leak: token=abc"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(makeRequest({ term: 49 }));

    expect(response.status).toBe(502);
    expect(errorSpy.mock.calls.join(" ")).not.toContain("secret leak");
  });
});
