import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getIapPublicKeysMock = vi.fn();
const verifySignedJwtWithCertsAsyncMock = vi.fn();

vi.mock("google-auth-library", () => ({
  OAuth2Client: class {
    getIapPublicKeys = getIapPublicKeysMock;
    verifySignedJwtWithCertsAsync = verifySignedJwtWithCertsAsyncMock;
  },
}));

const { verifyIapJwt } = await import("./verifyIapJwt");

const ORIGINAL_ENV = process.env.IAP_EXPECTED_AUDIENCE;

function headersWithAssertion(value: string | null): Headers {
  const headers = new Headers();
  if (value !== null) headers.set("x-goog-iap-jwt-assertion", value);
  return headers;
}

beforeEach(() => {
  process.env.IAP_EXPECTED_AUDIENCE = "/projects/123/locations/asia-northeast1/services/tcd-dashboard-dev";
  getIapPublicKeysMock.mockReset();
  verifySignedJwtWithCertsAsyncMock.mockReset();
});

afterEach(() => {
  process.env.IAP_EXPECTED_AUDIENCE = ORIGINAL_ENV;
  vi.restoreAllMocks();
});

describe("verifyIapJwt", () => {
  it("fails closed with missing_config when IAP_EXPECTED_AUDIENCE is unset", async () => {
    delete process.env.IAP_EXPECTED_AUDIENCE;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await verifyIapJwt(headersWithAssertion("dummy.jwt.value"));

    expect(result).toEqual({ ok: false, reason: "missing_config" });
    expect(getIapPublicKeysMock).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
  });

  it("fails with missing_header when X-Goog-Iap-Jwt-Assertion is absent", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await verifyIapJwt(headersWithAssertion(null));

    expect(result).toEqual({ ok: false, reason: "missing_header" });
    expect(getIapPublicKeysMock).not.toHaveBeenCalled();
  });

  it("verifies the assertion against IAP public keys and the configured audience, returning the verified email", async () => {
    getIapPublicKeysMock.mockResolvedValue({ pubkeys: { keyid: "pem-data" } });
    verifySignedJwtWithCertsAsyncMock.mockResolvedValue({
      getPayload: () => ({ email: "kawauchi@tcd.jp" }),
    });

    const result = await verifyIapJwt(headersWithAssertion("header.payload.signature"));

    expect(result).toEqual({ ok: true, email: "kawauchi@tcd.jp" });
    expect(verifySignedJwtWithCertsAsyncMock).toHaveBeenCalledWith(
      "header.payload.signature",
      { keyid: "pem-data" },
      "/projects/123/locations/asia-northeast1/services/tcd-dashboard-dev",
      ["https://cloud.google.com/iap"]
    );
  });

  it("fails with verification_failed when the verified payload has no email claim", async () => {
    getIapPublicKeysMock.mockResolvedValue({ pubkeys: {} });
    verifySignedJwtWithCertsAsyncMock.mockResolvedValue({ getPayload: () => ({}) });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await verifyIapJwt(headersWithAssertion("header.payload.signature"));

    expect(result).toEqual({ ok: false, reason: "verification_failed" });
  });

  it("fails closed with verification_failed on signature/expiry/audience mismatch, and never logs the exception content (which may embed the JWT itself)", async () => {
    getIapPublicKeysMock.mockResolvedValue({ pubkeys: {} });
    verifySignedJwtWithCertsAsyncMock.mockRejectedValue(
      new Error("Invalid token signature: header.super-secret-payload.signature")
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await verifyIapJwt(headersWithAssertion("header.super-secret-payload.signature"));

    expect(result).toEqual({ ok: false, reason: "verification_failed" });
    const loggedText = errorSpy.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(loggedText).not.toContain("super-secret-payload");
    expect(loggedText).not.toContain("header.super-secret-payload.signature");
  });
});
