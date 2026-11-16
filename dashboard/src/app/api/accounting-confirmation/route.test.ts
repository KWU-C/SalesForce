import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MANAGEMENT_DASHBOARD_ALLOWED_EMAILS } from "@/config/managementDashboardAccess";

const verifyIapJwtMock = vi.fn();
const saveMock = vi.fn();

vi.mock("@/services/iap/verifyIapJwt", () => ({ verifyIapJwt: verifyIapJwtMock }));
vi.mock("@/repositories/accountingConfirmationRepository", () => ({ saveAccountingConfirmation: saveMock }));

const { PUT } = await import("./route");

function put(body: unknown) {
  return PUT(
    new NextRequest("http://localhost/api/accounting-confirmation", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

afterEach(() => {
  verifyIapJwtMock.mockReset();
  saveMock.mockReset();
});

const allowed = MANAGEMENT_DASHBOARD_ALLOWED_EMAILS[0];

describe("PUT /api/accounting-confirmation", () => {
  it("IAP検証に失敗・許可リスト外なら403で保存しない", async () => {
    verifyIapJwtMock.mockResolvedValue({ ok: false, reason: "verification_failed" });
    expect((await put({ throughMonth: "2026-09" })).status).toBe(403);
    verifyIapJwtMock.mockResolvedValue({ ok: true, email: "someone@example.com" });
    expect((await put({ throughMonth: "2026-09" })).status).toBe(403);
    expect(saveMock).not.toHaveBeenCalled();
  });

  it.each([
    ["形式違い", { throughMonth: "2026-9" }],
    ["月末前の月", { throughMonth: "2999-01" }],
    ["項目なし", {}],
  ])("%sは400", async (_label, body) => {
    verifyIapJwtMock.mockResolvedValue({ ok: true, email: allowed });
    expect((await put(body)).status).toBe(400);
    expect(saveMock).not.toHaveBeenCalled();
  });

  it("検証済みのemailを更新者として保存する(nullは指定の解除)", async () => {
    verifyIapJwtMock.mockResolvedValue({ ok: true, email: allowed });
    saveMock.mockImplementation(async (input: { throughMonth: string | null }) => ({ throughMonth: input.throughMonth }));
    expect(await (await put({ throughMonth: "2026-09" })).json()).toEqual({ throughMonth: "2026-09" });
    expect(saveMock).toHaveBeenCalledWith({ throughMonth: "2026-09", updatedBy: allowed });
    expect((await put({ throughMonth: null })).status).toBe(200);
  });
});
