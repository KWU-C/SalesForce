import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const verifyIapJwtMock = vi.fn();
const refreshCurrentMonthSnapshotsMock = vi.fn();

vi.mock("@/services/iap/verifyIapJwt", () => ({
  verifyIapJwt: verifyIapJwtMock,
}));
vi.mock("@/features/management-dashboard/refreshCurrentMonthSnapshots", () => ({
  refreshCurrentMonthSnapshots: refreshCurrentMonthSnapshotsMock,
}));

const { POST } = await import("./route");

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/freee/monthly-finance/refresh", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  verifyIapJwtMock.mockReset();
  refreshCurrentMonthSnapshotsMock.mockReset();
});

describe("POST /api/freee/monthly-finance/refresh", () => {
  it("returns 403 when IAP verification fails or the email is not on the allowlist", async () => {
    verifyIapJwtMock.mockResolvedValue({ ok: false, reason: "verification_failed" });
    const response = await POST(makeRequest({ fiscalYear: 2025, month: 8 }));
    expect(response.status).toBe(403);
    expect(refreshCurrentMonthSnapshotsMock).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid month", async () => {
    verifyIapJwtMock.mockResolvedValue({ ok: true, email: "kawauchi@tcd.jp" });
    const response = await POST(makeRequest({ fiscalYear: 2025, month: 13 }));
    expect(response.status).toBe(400);
  });

  it("delegates to refreshCurrentMonthSnapshots with includeFinancialSummary:false by default and returns ok", async () => {
    verifyIapJwtMock.mockResolvedValue({ ok: true, email: "kawauchi@tcd.jp" });
    refreshCurrentMonthSnapshotsMock.mockResolvedValue({ connected: true });

    const response = await POST(makeRequest({ fiscalYear: 2025, month: 8 }));

    expect(response.status).toBe(200);
    expect(refreshCurrentMonthSnapshotsMock).toHaveBeenCalledWith(2025, 8, { includeFinancialSummary: false });
  });

  it("passes includeFinancialSummary:true through when requested", async () => {
    verifyIapJwtMock.mockResolvedValue({ ok: true, email: "kawauchi@tcd.jp" });
    refreshCurrentMonthSnapshotsMock.mockResolvedValue({ connected: true });

    const response = await POST(makeRequest({ fiscalYear: 2025, month: 8, includeFinancialSummary: true }));

    expect(response.status).toBe(200);
    expect(refreshCurrentMonthSnapshotsMock).toHaveBeenCalledWith(2025, 8, { includeFinancialSummary: true });
  });

  it("returns 409 when refreshCurrentMonthSnapshots reports connected:false", async () => {
    verifyIapJwtMock.mockResolvedValue({ ok: true, email: "kawauchi@tcd.jp" });
    refreshCurrentMonthSnapshotsMock.mockResolvedValue({ connected: false });

    const response = await POST(makeRequest({ fiscalYear: 2025, month: 8 }));

    expect(response.status).toBe(409);
  });

  it("returns 502 without leaking details when the computation fails", async () => {
    verifyIapJwtMock.mockResolvedValue({ ok: true, email: "kawauchi@tcd.jp" });
    refreshCurrentMonthSnapshotsMock.mockRejectedValue(new Error("secret leak: token=abc"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(makeRequest({ fiscalYear: 2025, month: 8 }));

    expect(response.status).toBe(502);
    expect(errorSpy.mock.calls.join(" ")).not.toContain("secret leak");
  });
});
