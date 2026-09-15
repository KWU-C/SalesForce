import { afterEach, describe, expect, it, vi } from "vitest";
import type { FundReserveCore } from "./fundReserve";

const getFundReserveSnapshotMock = vi.fn();
const saveFundReserveSnapshotMock = vi.fn();
const getFundReserveCoreMock = vi.fn();

vi.mock("@/repositories/fundReserveSnapshotRepository", () => ({
  getFundReserveSnapshot: getFundReserveSnapshotMock,
  saveFundReserveSnapshot: saveFundReserveSnapshotMock,
}));
vi.mock("./fundReserve", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./fundReserve")>();
  return { ...actual, getFundReserveCore: getFundReserveCoreMock };
});

const { getOrFetchFundReserveCore } = await import("./fundReserveService");

function makeCore(overrides: Partial<FundReserveCore> = {}): FundReserveCore {
  return {
    bonusReserveConfigured: false,
    bonusReserve: 0,
    otherPurposeLines: [],
    cashRestrictedTotal: 5000,
    insuranceAssetReserve: 300,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  getFundReserveSnapshotMock.mockReset();
  saveFundReserveSnapshotMock.mockReset();
  getFundReserveCoreMock.mockReset();
});

describe("getOrFetchFundReserveCore", () => {
  it("returns the cached snapshot without calling freee when one exists", async () => {
    const cached = { fiscalYear: 2025, month: 8, ...makeCore(), fetchedAt: new Date("2026-09-14T00:00:00Z") };
    getFundReserveSnapshotMock.mockResolvedValue(cached);

    const result = await getOrFetchFundReserveCore(2025, 8);

    expect(result).toEqual(cached);
    expect(getFundReserveCoreMock).not.toHaveBeenCalled();
  });

  it("computes from freee and backfills Firestore when there is no cache", async () => {
    getFundReserveSnapshotMock.mockResolvedValue(null);
    getFundReserveCoreMock.mockResolvedValue(makeCore({ insuranceAssetReserve: 999 }));

    const result = await getOrFetchFundReserveCore(2025, 8);

    expect(getFundReserveCoreMock).toHaveBeenCalledWith(2025, 8);
    expect(saveFundReserveSnapshotMock).toHaveBeenCalledWith(
      expect.objectContaining({ fiscalYear: 2025, month: 8, insuranceAssetReserve: 999 })
    );
    expect(result?.insuranceAssetReserve).toBe(999);
  });

  it("returns null when freee is not connected, never fabricating a snapshot", async () => {
    getFundReserveSnapshotMock.mockResolvedValue(null);
    getFundReserveCoreMock.mockResolvedValue(null);

    const result = await getOrFetchFundReserveCore(2025, 8);

    expect(result).toBeNull();
    expect(saveFundReserveSnapshotMock).not.toHaveBeenCalled();
  });

  it("forceRefresh always recomputes even when a cache entry exists", async () => {
    getFundReserveCoreMock.mockResolvedValue(makeCore({ insuranceAssetReserve: 555 }));

    const result = await getOrFetchFundReserveCore(2025, 8, { forceRefresh: true });

    expect(getFundReserveSnapshotMock).not.toHaveBeenCalled();
    expect(result?.insuranceAssetReserve).toBe(555);
  });
});
