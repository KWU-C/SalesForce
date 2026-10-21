import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cloud Run Jobsの実行環境(コンテナ実行規約で自動設定される環境変数)を再現して、
 * 定時更新Jobの開始時の判定を確かめる。書き込めない環境では、freee・Firestoreに一切触れる前に
 * 止まることを、最下層(Firestoreクライアント・freeeトークン・fetch)の呼び出し記録で確認する。
 */

const touched = vi.fn();
vi.mock("@/services/firestore/firestoreClient", () => ({
  getFirestoreClient: () => {
    touched("firestore");
    throw new Error("Firestore must not be reached");
  },
}));
vi.mock("@/repositories/freeeAuthRepository", () => ({
  getValidFreeeAccessToken: async () => {
    touched("freee-token");
    throw new Error("freee must not be reached");
  },
  getFreeeCompanyId: async () => {
    touched("freee-company");
    throw new Error("freee must not be reached");
  },
}));

const { runFinanceRefreshJob } = await import("./scheduledFinanceRefresh");

const ORIGINAL = { ...process.env };
const fetchSpy = vi.fn(async () => {
  touched("fetch");
  throw new Error("network must not be reached");
});

/** Cloud Run Jobsのタスクとして起動されたときの環境変数(K_SERVICEは設定されない) */
function asCloudRunJobTask(jobName: string | undefined) {
  for (const k of ["K_SERVICE", "K_REVISION", "K_CONFIGURATION", "CLOUD_RUN_JOB", "CLOUD_RUN_EXECUTION", "ALLOW_PRODUCTION_DATA_WRITES"]) delete process.env[k];
  if (jobName !== undefined) {
    process.env.CLOUD_RUN_JOB = jobName;
    process.env.CLOUD_RUN_EXECUTION = `${jobName}-abcde`;
  }
  process.env.CLOUD_RUN_TASK_INDEX = "0";
  process.env.CLOUD_RUN_TASK_ATTEMPT = "0";
  process.env.CLOUD_RUN_TASK_COUNT = "1";
}

beforeEach(() => {
  touched.mockReset();
  vi.stubGlobal("fetch", fetchSpy);
});
afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.unstubAllGlobals();
});

function capture() {
  const logs: string[] = [];
  const errors: string[] = [];
  return { logs, errors, log: (m: string) => logs.push(m), error: (m: string) => errors.push(m) };
}

describe("定時更新Job: 実行環境の判定(Cloud Run Jobsの環境変数を再現)", () => {
  it("runs on the production job and logs the job name and 'allowed'", async () => {
    asCloudRunJobTask("tcd-dashboard-prod-finance-refresh");
    const out = capture();
    const run = vi.fn(async () => ({ fiscalYear: 2026, month: 10, connected: true, refreshedPastMonths: [9], refreshedPreviousTerm: null }));
    expect(await runFinanceRefreshJob({ run, ...out })).toBe(0);
    expect(run).toHaveBeenCalledTimes(1);
    expect(out.logs[0]).toBe("[scheduledFinanceRefresh] 実行環境: job=tcd-dashboard-prod-finance-refresh / 本番データへの書き込み: 許可");
  });

  it.each([
    ["dev2のJob", "tcd-dashboard-dev2-finance-refresh", "job=tcd-dashboard-dev2-finance-refresh"],
    ["名前の違うJob", "tcd-dashboard-prod-finance-refresh-copy", "job=tcd-dashboard-prod-finance-refresh-copy"],
    ["CLOUD_RUN_JOBが無い", undefined, "local"],
  ])("stops before touching freee or Firestore: %s", async (_label, jobName, where) => {
    asCloudRunJobTask(jobName);
    const out = capture();
    // 本物の更新処理を渡しても、判定で止まって呼ばれないこと
    expect(await runFinanceRefreshJob(out)).toBe(1);
    expect(out.errors).toEqual([`[scheduledFinanceRefresh] 実行環境: ${where} / 本番データへの書き込み: 不可のため、更新を行いません`]);
    expect(out.logs).toEqual([]);
    expect(touched).not.toHaveBeenCalled();
  });

  it("does not let a stray K_SERVICE of dev2 or the local override unlock a job run", async () => {
    asCloudRunJobTask("tcd-dashboard-dev2-finance-refresh");
    process.env.ALLOW_PRODUCTION_DATA_WRITES = "true";
    expect(await runFinanceRefreshJob(capture())).toBe(1);
    process.env.K_SERVICE = "tcd-dashboard-dev2";
    expect(await runFinanceRefreshJob(capture())).toBe(1);
    expect(touched).not.toHaveBeenCalled();
  });

  it("returns 1 with a fixed message when freee is not connected or the refresh throws", async () => {
    asCloudRunJobTask("tcd-dashboard-prod-finance-refresh");
    const notConnected = capture();
    expect(await runFinanceRefreshJob({ run: async () => ({ fiscalYear: 2026, month: 10, connected: false, refreshedPastMonths: [], refreshedPreviousTerm: null }), ...notConnected })).toBe(1);
    expect(notConnected.errors[0]).toContain("freee未接続");
    const failed = capture();
    expect(await runFinanceRefreshJob({ run: async () => { throw new Error("freee_api_error"); }, ...failed })).toBe(1);
    expect(failed.errors[0]).toBe("[scheduledFinanceRefresh] 更新に失敗しました: freee_api_error");
  });
});
