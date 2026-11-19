import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MANAGEMENT_DASHBOARD_ALLOWED_EMAILS } from "@/config/managementDashboardAccess";

const verifyIapJwtMock = vi.fn();
const enabledMock = vi.fn();
const latestMock = vi.fn();
const addMock = vi.fn();
const collectMock = vi.fn();
const buildMock = vi.fn();

vi.mock("@/services/iap/verifyIapJwt", () => ({ verifyIapJwt: verifyIapJwtMock }));
vi.mock("@/features/management-dashboard/referenceForecast", () => ({ isReferenceForecastEnabled: enabledMock }));
vi.mock("@/repositories/referenceForecastRepository", () => ({ getLatestReferenceForecast: latestMock, addReferenceForecast: addMock }));
vi.mock("@/features/management-dashboard/referenceForecastEngine/collectInputs", () => ({ collectReferenceForecastInputs: collectMock }));
vi.mock("@/features/management-dashboard/referenceForecastEngine/buildRecord", () => ({ buildReferenceForecastRecord: buildMock }));

const { POST } = await import("./route");
const post = () => POST(new NextRequest("http://localhost/api/reference-forecast/recompute", { method: "POST" }));
const allowed = MANAGEMENT_DASHBOARD_ALLOWED_EMAILS[0];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const m of [verifyIapJwtMock, enabledMock, latestMock, addMock, collectMock, buildMock]) m.mockReset();
});

describe("POST /api/reference-forecast/recompute", () => {
  it("本番・dev以外のデータベースでは404で何も読まない", async () => {
    enabledMock.mockReturnValue(false);
    expect((await post()).status).toBe(404);
    expect(verifyIapJwtMock).not.toHaveBeenCalled();
    expect(collectMock).not.toHaveBeenCalled();
  });

  it("IAP検証に失敗・許可リスト外なら403", async () => {
    enabledMock.mockReturnValue(true);
    verifyIapJwtMock.mockResolvedValue({ ok: false, reason: "verification_failed" });
    expect((await post()).status).toBe(403);
    verifyIapJwtMock.mockResolvedValue({ ok: true, email: "someone@example.com" });
    expect((await post()).status).toBe(403);
    expect(collectMock).not.toHaveBeenCalled();
  });

  it("直前(2分以内)の記録があれば409で再計算しない", async () => {
    enabledMock.mockReturnValue(true);
    verifyIapJwtMock.mockResolvedValue({ ok: true, email: allowed });
    latestMock.mockResolvedValue({ id: "x", createdAt: new Date().toISOString() });
    expect((await post()).status).toBe(409);
    expect(collectMock).not.toHaveBeenCalled();
  });

  it("計算した記録を新しい記録として追加し、前の記録を損益の引き継ぎ元として渡す", async () => {
    vi.stubEnv("K_SERVICE", "tcd-dashboard-dev2");
    enabledMock.mockReturnValue(true);
    verifyIapJwtMock.mockResolvedValue({ ok: true, email: allowed });
    const previous = { id: "2026-11-16_20261118T104109", createdAt: "2026-11-18T10:41:09+09:00" };
    latestMock.mockResolvedValue(previous);
    collectMock.mockResolvedValue({ inputs: true });
    buildMock.mockReturnValue({ record: { id: "2026-11-18_20261118T130000", baseDate: "2026-11-18" }, warnings: [] });
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "2026-11-18_20261118T130000", baseDate: "2026-11-18", warnings: [] });
    expect(buildMock.mock.calls[0][1]).toMatchObject({ previous, createdBy: `DEVの再計算(${allowed})`, computeMode: "devRecompute" });
    expect(addMock).toHaveBeenCalledWith({ id: "2026-11-18_20261118T130000", baseDate: "2026-11-18" });
  });

  it("本番では「本番の再計算」として記録し、Gitのコミットとリビジョンを渡す(2026-11-19)", async () => {
    vi.stubEnv("K_SERVICE", "tcd-dashboard-prod");
    vi.stubEnv("K_REVISION", "tcd-dashboard-prod-00211-abc");
    vi.stubEnv("APP_COMMIT_SHA", "0123456789abcdef");
    enabledMock.mockReturnValue(true);
    verifyIapJwtMock.mockResolvedValue({ ok: true, email: allowed });
    latestMock.mockResolvedValue(null);
    collectMock.mockResolvedValue({ inputs: true });
    buildMock.mockReturnValue({ record: { id: "2026-11-18_20261119T130000", baseDate: "2026-11-18" }, warnings: [] });
    expect((await post()).status).toBe(200);
    expect(buildMock.mock.calls[0][1]).toMatchObject({
      previous: null,
      createdBy: `本番の再計算(${allowed})`,
      computeMode: "prodRecompute",
      codeCommit: "0123456789abcdef",
      codeRevision: "tcd-dashboard-prod-00211-abc",
    });
  });

  it("取得に失敗したら500で、記録は追加しない", async () => {
    enabledMock.mockReturnValue(true);
    verifyIapJwtMock.mockResolvedValue({ ok: true, email: allowed });
    latestMock.mockResolvedValue(null);
    collectMock.mockRejectedValue(Object.assign(new Error("freeeの読み取りに失敗しました(deals: forbidden, status=403)"), { name: "FreeeReadError" }));
    const res = await post();
    expect(res.status).toBe(500);
    expect((await res.json()).message).toContain("FreeeReadError");
    expect(addMock).not.toHaveBeenCalled();
  });
});
