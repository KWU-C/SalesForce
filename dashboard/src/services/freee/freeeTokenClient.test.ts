import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const {
  buildFreeeAuthorizeUrl,
  exchangeFreeeAuthorizationCode,
  refreshFreeeToken,
} = await import("./freeeTokenClient");

const ORIGINAL_CLIENT_ID = process.env.FREEE_CLIENT_ID;
const ORIGINAL_CLIENT_SECRET = process.env.FREEE_CLIENT_SECRET;

beforeEach(() => {
  process.env.FREEE_CLIENT_ID = "test-client-id";
  process.env.FREEE_CLIENT_SECRET = "test-client-secret";
  fetchMock.mockReset();
});

afterEach(() => {
  process.env.FREEE_CLIENT_ID = ORIGINAL_CLIENT_ID;
  process.env.FREEE_CLIENT_SECRET = ORIGINAL_CLIENT_SECRET;
  vi.restoreAllMocks();
});

describe("buildFreeeAuthorizeUrl", () => {
  it("throws when FREEE_CLIENT_ID is unset", () => {
    delete process.env.FREEE_CLIENT_ID;
    expect(() => buildFreeeAuthorizeUrl()).toThrow();
  });

  it("builds the authorize URL with the OOB redirect_uri (no web callback URL needed)", () => {
    const url = buildFreeeAuthorizeUrl();
    expect(url).toContain("https://accounts.secure.freee.co.jp/public_api/authorize?");
    expect(url).toContain("client_id=test-client-id");
    expect(url).toContain(`redirect_uri=${encodeURIComponent("urn:ietf:wg:oauth:2.0:oob")}`);
    expect(url).toContain("response_type=code");
  });
});

describe("exchangeFreeeAuthorizationCode", () => {
  it("posts the authorization_code grant and returns the parsed token response", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "at", refresh_token: "rt", expires_in: 21600 }),
    });

    const result = await exchangeFreeeAuthorizationCode("the-code");

    expect(result).toEqual({ access_token: "at", refresh_token: "rt", expires_in: 21600 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://accounts.secure.freee.co.jp/public_api/token");
    const body = new URLSearchParams(init.body as string);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("the-code");
    expect(body.get("client_id")).toBe("test-client-id");
    expect(body.get("client_secret")).toBe("test-client-secret");
    expect(body.get("redirect_uri")).toBe("urn:ietf:wg:oauth:2.0:oob");
  });

  it("throws without leaking the response body when the token endpoint errors", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: "invalid_grant" }) });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(exchangeFreeeAuthorizationCode("bad-code")).rejects.toThrow();
    expect(errorSpy.mock.calls.join(" ")).not.toContain("invalid_grant");
  });
});

describe("refreshFreeeToken", () => {
  it("posts the refresh_token grant", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "at2", refresh_token: "rt2", expires_in: 21600 }),
    });

    await refreshFreeeToken("old-refresh-token");

    const [, init] = fetchMock.mock.calls[0];
    const body = new URLSearchParams(init.body as string);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("old-refresh-token");
  });
});
