import { describe, expect, it, vi } from "vitest";

vi.mock("@/repositories/freeeAuthRepository", () => ({
  getValidFreeeAccessToken: async () => {
    throw new Error("the real token must not be used in tests");
  },
}));

const { FreeeReadError, getPayrollMonth, listDeals, listWalletables } = await import("./freeeForecastClient");

const getToken = async () => "test-token";
const json = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

describe("freeeForecastClient", () => {
  it("reads every page of deals and maps account names (unknown ids become empty, not a guessed account)", async () => {
    const page = (n: number, start: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: start + i,
        type: "expense",
        issue_date: "2026-10-01",
        due_date: "2026-10-31",
        amount: 100,
        due_amount: 100,
        status: "unsettled",
        partner_id: 7,
        details: [{ account_item_id: i === 0 ? 999 : 1, amount: 100 }],
      }));
    const fetch = vi.fn(async (url: string) => json(200, { deals: url.includes("offset=0") ? page(100, 0) : page(3, 100) }));
    const deals = await listDeals(1, { status: "unsettled" }, new Map([[1, "外注加工費"]]), { fetch, getToken });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(deals).toHaveLength(103);
    expect(deals[0].details[0].accountName).toBe("");
    expect(deals[1]).toMatchObject({ dueDate: "2026-10-31", dueAmount: 100, partnerId: 7, details: [{ accountName: "外注加工費", amount: 100 }] });
  });

  it("classifies a permission error as forbidden and others by status", async () => {
    const forbidden = listDeals(1, {}, new Map(), { fetch: async () => json(403, {}), getToken });
    await expect(forbidden).rejects.toBeInstanceOf(FreeeReadError);
    await expect(listDeals(1, {}, new Map(), { fetch: async () => json(403, {}), getToken })).rejects.toMatchObject({ kind: "forbidden", source: "deals", status: 403 });
    await expect(listDeals(1, {}, new Map(), { fetch: async () => json(429, {}), getToken })).rejects.toMatchObject({ kind: "rate_limited" });
    await expect(listWalletables(1, { fetch: async () => json(500, {}), getToken })).rejects.toMatchObject({ kind: "other", source: "walletables" });
  });

  it("stops instead of reading pages forever", async () => {
    const full = Array.from({ length: 100 }, (_, i) => ({ id: i, type: "income", issue_date: "2026-10-01", amount: 1, status: "settled" }));
    await expect(listDeals(1, {}, new Map(), { fetch: async () => json(200, { deals: full }), getToken })).rejects.toMatchObject({ kind: "too_many_pages" });
  });

  it("returns null for a month without payroll statements (404) but still fails on other errors", async () => {
    expect(await getPayrollMonth(1, "bonus", 2026, 12, { fetch: async () => json(404, {}), getToken })).toBeNull();
    await expect(getPayrollMonth(1, "bonus", 2026, 12, { fetch: async () => json(403, {}), getToken })).rejects.toMatchObject({ kind: "forbidden" });
  });

  it("sums net payments and takes the most common pay date", async () => {
    const body = {
      employee_payroll_statements: [
        { pay_date: "2026-10-25", net_payment_amount: "1000.0", fixed: true },
        { pay_date: "2026-10-25", net_payment_amount: 2000, fixed: false },
        { pay_date: "2026-10-24", net_payment_amount: null, fixed: false },
      ],
    };
    expect(await getPayrollMonth(1, "salary", 2026, 10, { fetch: async () => json(200, body), getToken })).toEqual({
      kind: "salary",
      month: "2026-10",
      netTotal: 3000,
      payDate: "2026-10-25",
      statementCount: 3,
      fixedCount: 1,
    });
  });
});
