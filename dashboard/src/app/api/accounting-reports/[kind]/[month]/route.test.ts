import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const verifyIapJwtMock = vi.fn();
const saveAccountingReportMock = vi.fn();

vi.mock("@/services/iap/verifyIapJwt", () => ({ verifyIapJwt: verifyIapJwtMock }));
vi.mock("@/repositories/accountingReportRepository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/repositories/accountingReportRepository")>();
  return { ...actual, saveAccountingReport: saveAccountingReportMock };
});

const { PUT } = await import("./route");
const { ChangeTypeRequiredError } = await import("@/repositories/accountingReportRepository");

const VALUES = { revenueCumulative: 100, ordinaryProfitCumulative: -1, documentName: "経理報告" };

function put(kind: string, month: string, body: unknown) {
  const request = new NextRequest(`http://localhost/api/accounting-reports/${kind}/${month}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return PUT(request, { params: Promise.resolve({ kind, month }) });
}

afterEach(() => {
  verifyIapJwtMock.mockReset();
  saveAccountingReportMock.mockReset();
});

describe("PUT /api/accounting-reports/[kind]/[month]", () => {
  it("rejects an unknown kind or malformed month before checking IAP", async () => {
    expect((await put("other", "2026-09", { values: VALUES })).status).toBe(400);
    expect((await put("monthly-report", "2026-13", { values: VALUES })).status).toBe(400);
    expect(verifyIapJwtMock).not.toHaveBeenCalled();
  });

  it("returns 403 when IAP fails or the user is not on the management allowlist", async () => {
    verifyIapJwtMock.mockResolvedValueOnce({ ok: false, reason: "verification_failed" });
    expect((await put("monthly-report", "2026-09", { values: VALUES })).status).toBe(403);
    verifyIapJwtMock.mockResolvedValueOnce({ ok: true, email: "someone@tcd.jp" });
    expect((await put("monthly-report", "2026-09", { values: VALUES })).status).toBe(403);
    expect(saveAccountingReportMock).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid values or change type", async () => {
    verifyIapJwtMock.mockResolvedValue({ ok: true, email: "kawauchi@tcd.jp" });
    expect((await put("monthly-report", "2026-09", { values: { ...VALUES, revenueCumulative: "x" } })).status).toBe(400);
    expect((await put("monthly-report", "2026-09", { values: VALUES, changeType: "delete" })).status).toBe(400);
    expect(saveAccountingReportMock).not.toHaveBeenCalled();
  });

  it("saves with the verified email", async () => {
    verifyIapJwtMock.mockResolvedValue({ ok: true, email: "kawauchi@tcd.jp" });
    saveAccountingReportMock.mockResolvedValue({ targetMonth: "2026-10" });
    const response = await put("cash-plan", "2026-10", {
      values: { checkingSavingsTotal: 1, documentName: "資金繰り" },
      changeType: "forecastUpdate",
    });
    expect(response.status).toBe(200);
    expect(saveAccountingReportMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "cash-plan", targetMonth: "2026-10", changeType: "forecastUpdate", updatedBy: "kawauchi@tcd.jp" })
    );
  });

  it("returns 409 when overwriting without an allowed reason", async () => {
    verifyIapJwtMock.mockResolvedValue({ ok: true, email: "kawauchi@tcd.jp" });
    saveAccountingReportMock.mockRejectedValue(new ChangeTypeRequiredError());
    expect((await put("monthly-report", "2026-09", { values: VALUES })).status).toBe(409);
  });
});
