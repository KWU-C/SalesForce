// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RefreshMonthButton } from "./RefreshMonthButton";
import { RefreshTermButton } from "./RefreshTermButton";
import { RefreshOverlayProvider } from "./RefreshOverlay";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

function deferredFetch() {
  let resolve: (ok: boolean) => void = () => {};
  const promise = new Promise<Response>((r) => {
    resolve = (ok) => r({ ok } as Response);
  });
  vi.stubGlobal("fetch", vi.fn(() => promise));
  return (ok: boolean) => act(async () => resolve(ok));
}

const overlayShown = () => screen.queryByRole("status", { name: "読み込み中" }) !== null;

describe("更新ボタンの読み込み表示", () => {
  beforeEach(() => refresh.mockClear());
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("「この月をfreeeから更新」: 取得中は本文に読み込み表示を重ね、成功後に再描画して消す", async () => {
    const finish = deferredFetch();
    render(
      <RefreshOverlayProvider>
        <RefreshMonthButton fiscalYear={2025} month={8} />
      </RefreshOverlayProvider>
    );
    expect(overlayShown()).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "この月をfreeeから更新" }));
    expect(overlayShown()).toBe(true);
    expect(screen.getByRole("button", { name: "更新中..." })).toHaveProperty("disabled", true);

    await finish(true);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(overlayShown()).toBe(false);
  });

  it("ヘッダーの「更新」・「この期をfreeeから更新」も同じ読み込み表示になる", async () => {
    const finish = deferredFetch();
    render(
      <RefreshOverlayProvider>
        <RefreshMonthButton fiscalYear={2025} month={9} label="更新" includeFinancialSummary />
        <RefreshTermButton term={49} />
      </RefreshOverlayProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "更新" }));
    fireEvent.click(screen.getByRole("button", { name: "この期をfreeeから更新" }));
    expect(screen.getAllByRole("status", { name: "読み込み中" })).toHaveLength(1); // 重ねても1つだけ

    await finish(true);
    expect(overlayShown()).toBe(false);
  });

  it("取得に失敗したら読み込み表示を消してエラーを出す(再描画しない)", async () => {
    const finish = deferredFetch();
    render(
      <RefreshOverlayProvider>
        <RefreshMonthButton fiscalYear={2025} month={8} />
      </RefreshOverlayProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "この月をfreeeから更新" }));
    await finish(false);

    expect(overlayShown()).toBe(false);
    expect(screen.getByText("更新に失敗しました")).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });
});
