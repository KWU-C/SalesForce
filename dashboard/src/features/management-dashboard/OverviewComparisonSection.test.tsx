// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CashComparison } from "./OverviewComparisonSection";
import { summarizeCurrentCash, summarizePreviousMonthCash, targetMonth } from "./overviewComparison";

// 金額はすべて架空の値
const october = targetMonth(50, 10);
const now = new Date("2026-11-13T03:00:00Z");
const snapshot = {
  cashClosing: 1_307,
  checkingSavingsClosing: 1_000,
  timeDepositClosing: 300,
  cashOnHandClosing: 7,
  fetchedAt: new Date("2026-11-01T09:00:00Z"),
};

function cardOf(label: string): HTMLElement {
  const card = screen.getAllByText(label)[0].closest("div");
  if (!card) throw new Error(label);
  return card;
}

describe("資金サマリーの担保控除後", () => {
  afterEach(cleanup);

  it("未設定は「未設定」と出し、控除前の合計は参考値として別名で出す。明示の0円は金額で出す", () => {
    render(
      <CashComparison
        target={october}
        previous={summarizePreviousMonthCash(october, snapshot, { amount: null, asOf: null, source: null }, now)}
        current={summarizeCurrentCash({ ...snapshot, fetchedAt: now }, { amount: 0, asOf: "2026-11-01", source: "架空" })}
        currentMonthLabel="2026年11月"
      />
    );
    const cards = screen.getAllByText("預金総合計（担保控除後）").map((el) => el.closest("div") as HTMLElement);
    expect(cards).toHaveLength(2);
    // 左=前月末(未設定)
    expect(within(cards[0]).getByText("未設定")).toBeTruthy();
    expect(within(cards[0]).getByText("参考: 預金合計（担保控除前） ¥1,300")).toBeTruthy();
    expect(within(cards[0]).getByText("担保控除額: 未設定（経理の管理設定なし）")).toBeTruthy();
    // 右=現在(明示の0円 → 控除後 = 控除前)
    expect(within(cards[1]).getByText("¥1,300")).toBeTruthy();
    expect(within(cards[1]).getByText("担保控除額 ¥0（2026-11-01時点、架空）")).toBeTruthy();
    // 現預金のラベルは前月末/取得時点で区別する
    expect(cardOf("前月末現預金")).toBeTruthy();
    expect(cardOf("現預金残高（取得時点）")).toBeTruthy();
  });

  it("前月末の残高が月末前の取得しか無ければ未取得と理由を出す(0円にしない)", () => {
    render(
      <CashComparison
        target={october}
        previous={summarizePreviousMonthCash(
          october,
          { ...snapshot, fetchedAt: new Date("2026-10-31T09:00:00Z") },
          { amount: null, asOf: null, source: null },
          now
        )}
        current={summarizeCurrentCash(null, { amount: null, asOf: null, source: null })}
        currentMonthLabel="2026年11月"
      />
    );
    expect(within(cardOf("当座・普通預金合計")).getByText("未取得")).toBeTruthy();
    expect(screen.getByText(/2026年10月末より後にfreeeから取得した種類別の残高がありません/)).toBeTruthy();
  });
});
