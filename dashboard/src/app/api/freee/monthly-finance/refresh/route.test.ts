import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const verifyIapJwtMock = vi.fn();
const getOrFetchMonthlyCashFlowMock = vi.fn();
const getOrFetchLoanStatusMock = vi.fn();
const getOrFetchFundReserveCoreMock = vi.fn();

vi.mock("@/services/iap/verifyIapJwt", () => ({
  verifyIapJwt: verifyIapJwtMock,
}));
vi.mock("@/features/management-dashboard/monthlyCashFlowService", () => ({
  getOrFetchMonthlyCashFlow: getOrFetchMonthlyCashFlowMock,
}));
vi.mock("@/features/management-dashboard/loanStatusService", () => ({
  getOrFetchLoanStatus: getOrFetchLoanStatusMock,
}));
vi.mock("@/features/management-dashboard/fundReserveService", () => ({
  getOrFetchFundReserveCore: getOrFetchFundReserveCoreMock,
}));

const { POST } = await import("./route");

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/freee/monthly-finance/refresh", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function mockAllSucceed() {
  getOrFetchMonthlyCashFlowMock.mockResolvedValue({ fiscalYear: 2025, month: 8 });
  getOrFetchLoanStatusMock.mockResolvedValue({ fiscalYear: 2025, month: 8 });
  getOrFetchFundReserveCoreMock.mockResolvedValue({ fiscalYear: 2025, month: 8 });
}

afterEach(() => {
  vi.restoreAllMocks();
  verifyIapJwtMock.mockReset();
  getOrFetchMonthlyCashFlowMock.mockReset();
  getOrFetchLoanStatusMock.mockReset();
  getOrFetchFundReserveCoreMock.mockReset();
});

describe("POST /api/freee/monthly-finance/refresh", () => {
  it("returns 403 when IAP verification fails or the email is not on the allowlist", async () => {
    verifyIapJwtMock.mockResolvedValue({ ok: false, reason: "verification_failed" });
    const response = await POST(makeRequest({ fiscalYear: 2025, month: 8 }));
    expect(response.status).toBe(403);
    expect(getOrFetchMonthlyCashFlowMock).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid month", async () => {
    verifyIapJwtMock.mockResolvedValue({ ok: true, email: "kawauchi@tcd.jp" });
    const response = await POST(makeRequest({ fiscalYear: 2025, month: 13 }));
    expect(response.status).toBe(400);
  });

  it("force-refreshes all three snapshots (cashFlow/loanStatus/fundReserveCore) for the requested month and returns ok", async () => {
    verifyIapJwtMock.mockResolvedValue({ ok: true, email: "kawauchi@tcd.jp" });
    mockAllSucceed();

    const response = await POST(makeRequest({ fiscalYear: 2025, month: 8 }));

    expect(response.status).toBe(200);
    expect(getOrFetchMonthlyCashFlowMock).toHaveBeenCalledWith(2025, 8, { forceRefresh: true });
    expect(getOrFetchLoanStatusMock).toHaveBeenCalledWith(2025, 8, { forceRefresh: true });
    expect(getOrFetchFundReserveCoreMock).toHaveBeenCalledWith(2025, 8, { forceRefresh: true });
  });

  it("returns 409 when freee is not connected (any of the three returns null)", async () => {
    verifyIapJwtMock.mockResolvedValue({ ok: true, email: "kawauchi@tcd.jp" });
    mockAllSucceed();
    getOrFetchLoanStatusMock.mockResolvedValue(null);

    const response = await POST(makeRequest({ fiscalYear: 2025, month: 8 }));

    expect(response.status).toBe(409);
  });

  it("returns 502 without leaking details when the computation fails", async () => {
    verifyIapJwtMock.mockResolvedValue({ ok: true, email: "kawauchi@tcd.jp" });
    mockAllSucceed();
    getOrFetchMonthlyCashFlowMock.mockRejectedValue(new Error("secret leak: token=abc"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(makeRequest({ fiscalYear: 2025, month: 8 }));

    expect(response.status).toBe(502);
    expect(errorSpy.mock.calls.join(" ")).not.toContain("secret leak");
  });
});
